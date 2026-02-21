// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../core/ConditionalTokens.sol";

/**
 * @title OptimisticOracle
 * @notice Simplified UMA Optimistic Oracle for prediction market resolution
 *
 * Flow:
 *   1. Market creator calls prepareMarket() with a question and expiration time
 *   2. After expiration, anyone calls proposeAnswer() with a bond
 *   3. Dispute window opens (DISPUTE_WINDOW seconds)
 *   4a. No dispute → anyone calls settle() → CTF resolves → winners can redeem
 *   4b. Disputed → arbitrator calls resolveDispute() → same resolution + slash loser bond
 */
contract OptimisticOracle {
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────

    uint256 public constant DISPUTE_WINDOW = 1 hours;
    uint256 public constant MIN_BOND       = 100e6; // 100 USDC

    // ── Types ─────────────────────────────────────────────────────────────

    enum Outcome  { UNRESOLVED, YES, NO }
    enum Stage    { PENDING, PROPOSED, DISPUTED, SETTLED }

    struct Market {
        bytes32   conditionId;
        address   creator;
        uint256   expiration;     // unix timestamp after which proposals allowed
        Stage     stage;
        Outcome   proposedAnswer;
        address   proposer;
        uint256   proposerBond;
        uint256   proposedAt;
        address   disputer;
        uint256   disputerBond;
        bool      resolved;
    }

    // ── State ──────────────────────────────────────────────────────────────

    IERC20             public immutable bond;       // USDC used for bonds
    ConditionalTokens  public immutable ctf;
    address            public arbitrator;           // trusted dispute resolver

    mapping(bytes32 => Market) public markets;      // questionId => Market

    // ── Events ─────────────────────────────────────────────────────────────

    event MarketPrepared(bytes32 indexed questionId, bytes32 conditionId, uint256 expiration);
    event AnswerProposed(bytes32 indexed questionId, Outcome answer, address proposer, uint256 bond);
    event AnswerDisputed(bytes32 indexed questionId, address disputer, uint256 bond);
    event MarketSettled (bytes32 indexed questionId, Outcome outcome);
    event DisputeResolved(bytes32 indexed questionId, Outcome outcome, address winner);

    // ── Constructor ────────────────────────────────────────────────────────

    constructor(address _bond, address _ctf, address _arbitrator) {
        bond       = IERC20(_bond);
        ctf        = ConditionalTokens(_ctf);
        arbitrator = _arbitrator;
    }

    // ── Market Lifecycle ───────────────────────────────────────────────────

    /**
     * @notice Register a market with the oracle
     * @param questionId  keccak256 of the question string
     * @param conditionId the CTF conditionId (must already be prepared)
     * @param expiration  unix timestamp after which resolution is allowed
     */
    function prepareMarket(
        bytes32 questionId,
        bytes32 conditionId,
        uint256 expiration
    ) external {
        require(markets[questionId].creator == address(0), "already registered");
        require(expiration > block.timestamp, "expiration must be future");
        require(ctf.getOutcomeSlotCount(conditionId) > 0, "condition not prepared");

        markets[questionId] = Market({
            conditionId:    conditionId,
            creator:        msg.sender,
            expiration:     expiration,
            stage:          Stage.PENDING,
            proposedAnswer: Outcome.UNRESOLVED,
            proposer:       address(0),
            proposerBond:   0,
            proposedAt:     0,
            disputer:       address(0),
            disputerBond:   0,
            resolved:       false
        });

        emit MarketPrepared(questionId, conditionId, expiration);
    }

    /**
     * @notice Propose an answer after market expiration
     * @param questionId  the market to resolve
     * @param answer      YES (1) or NO (2)
     * @param bondAmount  must be >= MIN_BOND
     */
    function proposeAnswer(
        bytes32 questionId,
        Outcome answer,
        uint256 bondAmount
    ) external {
        Market storage m = markets[questionId];
        require(m.creator != address(0),       "market not registered");
        require(m.stage == Stage.PENDING,       "not in PENDING stage");
        require(block.timestamp >= m.expiration,"market not expired yet");
        require(answer == Outcome.YES || answer == Outcome.NO, "invalid answer");
        require(bondAmount >= MIN_BOND,         "bond too small");

        bond.safeTransferFrom(msg.sender, address(this), bondAmount);

        m.stage          = Stage.PROPOSED;
        m.proposedAnswer = answer;
        m.proposer       = msg.sender;
        m.proposerBond   = bondAmount;
        m.proposedAt     = block.timestamp;

        emit AnswerProposed(questionId, answer, msg.sender, bondAmount);
    }

    /**
     * @notice Dispute a proposed answer within the dispute window
     * @param questionId  the market to dispute
     * @param bondAmount  must match proposer's bond
     */
    function disputeAnswer(bytes32 questionId, uint256 bondAmount) external {
        Market storage m = markets[questionId];
        require(m.stage == Stage.PROPOSED,                   "not in PROPOSED stage");
        require(block.timestamp < m.proposedAt + DISPUTE_WINDOW, "dispute window closed");
        require(bondAmount >= m.proposerBond,                "bond must match proposer");

        bond.safeTransferFrom(msg.sender, address(this), bondAmount);

        m.stage        = Stage.DISPUTED;
        m.disputer     = msg.sender;
        m.disputerBond = bondAmount;

        emit AnswerDisputed(questionId, msg.sender, bondAmount);
    }

    /**
     * @notice Settle an undisputed proposal after the dispute window
     */
    function settle(bytes32 questionId) external {
        Market storage m = markets[questionId];
        require(m.stage == Stage.PROPOSED,                       "not in PROPOSED stage");
        require(block.timestamp >= m.proposedAt + DISPUTE_WINDOW,"dispute window still open");

        _resolve(questionId, m.proposedAnswer);

        // Return proposer's bond — they were right (no dispute)
        bond.safeTransfer(m.proposer, m.proposerBond);

        emit MarketSettled(questionId, m.proposedAnswer);
    }

    /**
     * @notice Arbitrator resolves a dispute
     * @param questionId  disputed market
     * @param correctAnswer  arbitrator's ruling
     */
    function resolveDispute(bytes32 questionId, Outcome correctAnswer) external {
        require(msg.sender == arbitrator, "only arbitrator");
        Market storage m = markets[questionId];
        require(m.stage == Stage.DISPUTED, "not in DISPUTED stage");

        _resolve(questionId, correctAnswer);

        // Winner gets both bonds; loser's bond is slashed
        address winner;
        uint256 totalBond = m.proposerBond + m.disputerBond;

        if (correctAnswer == m.proposedAnswer) {
            // Proposer was right, disputer was wrong
            winner = m.proposer;
        } else {
            // Disputer was right, proposer was wrong
            winner = m.disputer;
        }

        bond.safeTransfer(winner, totalBond);

        emit DisputeResolved(questionId, correctAnswer, winner);
    }

    // ── Internal ───────────────────────────────────────────────────────────

    function _resolve(bytes32 questionId, Outcome outcome) internal {
        Market storage m = markets[questionId];
        require(!m.resolved, "already resolved");

        m.resolved = true;
        m.stage    = Stage.SETTLED;

        // Report payouts to CTF
        // YES wins → payouts = [1, 0]  (indexSet 1 = YES gets everything)
        // NO  wins → payouts = [0, 1]  (indexSet 2 = NO  gets everything)
        uint256[] memory payouts = new uint256[](2);
        if (outcome == Outcome.YES) {
            payouts[0] = 1;
            payouts[1] = 0;
        } else {
            payouts[0] = 0;
            payouts[1] = 1;
        }

        ctf.reportPayouts(questionId, payouts);
    }

    // ── View helpers ───────────────────────────────────────────────────────

    function getMarket(bytes32 questionId) external view returns (Market memory) {
        return markets[questionId];
    }

    function timeUntilExpiry(bytes32 questionId) external view returns (int256) {
        return int256(markets[questionId].expiration) - int256(block.timestamp);
    }

    function timeUntilDisputeClose(bytes32 questionId) external view returns (int256) {
        Market storage m = markets[questionId];
        if (m.stage != Stage.PROPOSED) return 0;
        return int256(m.proposedAt + DISPUTE_WINDOW) - int256(block.timestamp);
    }
}
