// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/core/ConditionalTokens.sol";
import "../src/core/MockUSDC.sol";
import "../src/oracle/OptimisticOracle.sol";

contract OptimisticOracleTest is Test {

    ConditionalTokens  ctf;
    MockUSDC           usdc;
    OptimisticOracle   oracle;

    address alice      = makeAddr("alice");      // market creator
    address proposer   = makeAddr("proposer");   // proposes answer
    address disputer   = makeAddr("disputer");   // disputes answer
    address arbitrator = makeAddr("arbitrator"); // resolves disputes

    bytes32 constant QUESTION_ID = keccak256("Will ETH hit $10k in 2025?");
    bytes32 conditionId;
    uint256 EXPIRATION;

    function setUp() public {
        usdc   = new MockUSDC();
        ctf    = new ConditionalTokens();
        oracle = new OptimisticOracle(address(usdc), address(ctf), arbitrator);

        // Mint bond USDC
        usdc.mint(proposer,   10_000e6);
        usdc.mint(disputer,   10_000e6);
        usdc.mint(alice,       1_000e6);

        vm.prank(proposer);  usdc.approve(address(oracle), type(uint256).max);
        vm.prank(disputer);  usdc.approve(address(oracle), type(uint256).max);

        // Prepare CTF condition (oracle is the "oracle" for the condition)
        vm.prank(address(oracle));
        ctf.prepareCondition(address(oracle), QUESTION_ID, 2);
        conditionId = ctf.getConditionId(address(oracle), QUESTION_ID, 2);

        EXPIRATION = block.timestamp + 1 days;

        // Register market
        vm.prank(alice);
        oracle.prepareMarket(QUESTION_ID, conditionId, EXPIRATION);
    }

    // ── Happy path: no dispute ──────────────────────────────────────────

    function test_ProposeAndSettle_YES() public {
        // Fast-forward past expiration
        vm.warp(EXPIRATION + 1);

        uint256 bondBefore = usdc.balanceOf(proposer);

        vm.prank(proposer);
        oracle.proposeAnswer(QUESTION_ID, OptimisticOracle.Outcome.YES, 200e6);

        // Fast-forward past dispute window
        vm.warp(EXPIRATION + 1 + oracle.DISPUTE_WINDOW() + 1);

        oracle.settle(QUESTION_ID);

        // Bond returned to proposer
        assertEq(usdc.balanceOf(proposer), bondBefore);

        // CTF payouts set: YES wins
        uint256[] memory payouts = ctf.getPayouts(conditionId);
        assertEq(payouts[0], 1); // YES
        assertEq(payouts[1], 0); // NO
    }

    function test_ProposeAndSettle_NO() public {
        vm.warp(EXPIRATION + 1);

        vm.prank(proposer);
        oracle.proposeAnswer(QUESTION_ID, OptimisticOracle.Outcome.NO, 200e6);

        vm.warp(EXPIRATION + 1 + oracle.DISPUTE_WINDOW() + 1);
        oracle.settle(QUESTION_ID);

        uint256[] memory payouts = ctf.getPayouts(conditionId);
        assertEq(payouts[0], 0);
        assertEq(payouts[1], 1);
    }

    // ── Dispute: proposer wrong ─────────────────────────────────────────

    function test_Dispute_DisputerWins() public {
        vm.warp(EXPIRATION + 1);

        // Proposer says YES (wrong)
        vm.prank(proposer);
        oracle.proposeAnswer(QUESTION_ID, OptimisticOracle.Outcome.YES, 200e6);

        // Disputer challenges
        vm.prank(disputer);
        oracle.disputeAnswer(QUESTION_ID, 200e6);

        uint256 disputerBefore = usdc.balanceOf(disputer);

        // Arbitrator rules NO (disputer was right)
        vm.prank(arbitrator);
        oracle.resolveDispute(QUESTION_ID, OptimisticOracle.Outcome.NO);

        // Disputer gets both bonds (400 USDC)
        assertEq(usdc.balanceOf(disputer), disputerBefore + 400e6);

        // CTF payouts: NO wins
        uint256[] memory payouts = ctf.getPayouts(conditionId);
        assertEq(payouts[1], 1);
    }

    function test_Dispute_ProposerWins() public {
        vm.warp(EXPIRATION + 1);

        vm.prank(proposer);
        oracle.proposeAnswer(QUESTION_ID, OptimisticOracle.Outcome.YES, 200e6);

        vm.prank(disputer);
        oracle.disputeAnswer(QUESTION_ID, 200e6);

        uint256 proposerBefore = usdc.balanceOf(proposer);

        // Arbitrator rules YES (proposer was right)
        vm.prank(arbitrator);
        oracle.resolveDispute(QUESTION_ID, OptimisticOracle.Outcome.YES);

        // Proposer gets both bonds
        assertEq(usdc.balanceOf(proposer), proposerBefore + 400e6);

        uint256[] memory payouts = ctf.getPayouts(conditionId);
        assertEq(payouts[0], 1);
    }

    // ── Revert cases ────────────────────────────────────────────────────

    function test_Revert_ProposeBeforeExpiry() public {
        vm.prank(proposer);
        vm.expectRevert("market not expired yet");
        oracle.proposeAnswer(QUESTION_ID, OptimisticOracle.Outcome.YES, 200e6);
    }

    function test_Revert_SettleBeforeDisputeWindow() public {
        vm.warp(EXPIRATION + 1);
        vm.prank(proposer);
        oracle.proposeAnswer(QUESTION_ID, OptimisticOracle.Outcome.YES, 200e6);

        vm.expectRevert("dispute window still open");
        oracle.settle(QUESTION_ID);
    }

    function test_Revert_DisputeAfterWindow() public {
        vm.warp(EXPIRATION + 1);
        vm.prank(proposer);
        oracle.proposeAnswer(QUESTION_ID, OptimisticOracle.Outcome.YES, 200e6);

        vm.warp(EXPIRATION + 1 + oracle.DISPUTE_WINDOW() + 1);

        vm.prank(disputer);
        vm.expectRevert("dispute window closed");
        oracle.disputeAnswer(QUESTION_ID, 200e6);
    }

    function test_Revert_BondTooSmall() public {
        vm.warp(EXPIRATION + 1);
        vm.prank(proposer);
        vm.expectRevert("bond too small");
        oracle.proposeAnswer(QUESTION_ID, OptimisticOracle.Outcome.YES, 50e6);
    }

    function test_Revert_OnlyArbitrator() public {
        vm.warp(EXPIRATION + 1);
        vm.prank(proposer);
        oracle.proposeAnswer(QUESTION_ID, OptimisticOracle.Outcome.YES, 200e6);
        vm.prank(disputer);
        oracle.disputeAnswer(QUESTION_ID, 200e6);

        vm.prank(alice);
        vm.expectRevert("only arbitrator");
        oracle.resolveDispute(QUESTION_ID, OptimisticOracle.Outcome.YES);
    }

    // ── Full redemption flow ─────────────────────────────────────────────

    function test_FullFlow_RedeemWinnings() public {
        // Give alice YES tokens (simulate buying)
        uint256[] memory partition = new uint256[](2);
        partition[0] = 1; partition[1] = 2;

        usdc.mint(alice, 1000e6);
        vm.startPrank(alice);
        usdc.approve(address(ctf), 1000e6);
        ctf.splitPosition(usdc, bytes32(0), conditionId, partition, 1000e6);
        vm.stopPrank();

        uint256 yesTokenId = ctf.getPositionId(
            address(usdc),
            ctf.getCollectionId(bytes32(0), conditionId, 1)
        );

        assertEq(ctf.balanceOf(alice, yesTokenId), 1000e6);

        // Market expires, YES proposed & settled
        vm.warp(EXPIRATION + 1);
        vm.prank(proposer);
        oracle.proposeAnswer(QUESTION_ID, OptimisticOracle.Outcome.YES, 200e6);
        vm.warp(EXPIRATION + 1 + oracle.DISPUTE_WINDOW() + 1);
        oracle.settle(QUESTION_ID);

        // Alice redeems YES tokens → gets USDC back
        uint256[] memory indexSets = new uint256[](1);
        indexSets[0] = 1; // YES

        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        ctf.redeemPositions(usdc, bytes32(0), conditionId, indexSets);

        assertEq(usdc.balanceOf(alice), usdcBefore + 1000e6);
        assertEq(ctf.balanceOf(alice, yesTokenId), 0);
    }
}
