// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "../libraries/CTHelpers.sol";

/**
 * @title ConditionalTokens
 * @notice 复刻自 Gnosis CTF，Polymarket 所有 YES/NO token 的底层
 *
 * 核心流程：
 *   1. prepareCondition()  注册问题，绑定 oracle
 *   2. splitPosition()     存 USDC → 铸出 YES + NO token
 *   3. [用户交易 YES/NO token，价格由市场决定]
 *   4. mergePositions()    烧 YES + NO → 取回 USDC（可选，随时退出）
 *   5. reportPayouts()     oracle 上报结果
 *   6. redeemPositions()   赢家烧掉 token 取走 USDC
 */
contract ConditionalTokens is ERC1155 {
    using SafeERC20 for IERC20;

    // conditionId => 每个 outcome 的支付分子
    // YES 赢: [1, 0]   NO 赢: [0, 1]   平局: [1, 1]
    mapping(bytes32 => uint[]) public payoutNumerators;

    // conditionId => 支付分母（未结算=0，结算后=分子之和）
    mapping(bytes32 => uint) public payoutDenominator;

    // ── 事件 ──────────────────────────────────────────────────────────────

    event ConditionPreparation(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint outcomeSlotCount
    );

    event ConditionResolution(
        bytes32 indexed conditionId,
        address indexed oracle,
        bytes32 indexed questionId,
        uint outcomeSlotCount,
        uint[] payoutNumerators
    );

    event PositionSplit(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 indexed conditionId,
        uint[] partition,
        uint amount
    );

    event PositionsMerge(
        address indexed stakeholder,
        IERC20 collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 indexed conditionId,
        uint[] partition,
        uint amount
    );

    event PayoutRedemption(
        address indexed redeemer,
        IERC20 indexed collateralToken,
        bytes32 indexed parentCollectionId,
        bytes32 conditionId,
        uint[] indexSets,
        uint payout
    );

    constructor() ERC1155("") {}

    // ── Step 1: 注册条件 ─────────────────────────────────────────────────

    /**
     * @param oracle           只有这个地址能 reportPayouts（Polymarket 用 UMA adapter）
     * @param questionId       问题唯一标识（通常是 UMA ancillaryData 的 keccak256）
     * @param outcomeSlotCount 结果数量，二元市场固定为 2
     */
    function prepareCondition(
        address oracle,
        bytes32 questionId,
        uint outcomeSlotCount
    ) external {
        require(outcomeSlotCount > 1, "need at least 2 outcomes");
        require(outcomeSlotCount <= 256, "too many outcome slots");

        bytes32 conditionId = CTHelpers.getConditionId(oracle, questionId, outcomeSlotCount);
        require(payoutNumerators[conditionId].length == 0, "already prepared");

        payoutNumerators[conditionId] = new uint[](outcomeSlotCount);

        emit ConditionPreparation(conditionId, oracle, questionId, outcomeSlotCount);
    }

    // ── Step 2: 分割仓位 USDC → YES + NO ─────────────────────────────────

    /**
     * @param collateralToken     USDC
     * @param parentCollectionId  顶层固定为 bytes32(0)
     * @param conditionId         prepareCondition 返回的 ID
     * @param partition           位掩码数组，二元市场传 [1, 2]（[0b01, 0b10]）
     * @param amount              存入多少 USDC，就铸出多少 YES 和多少 NO
     */
    function splitPosition(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint[] calldata partition,
        uint amount
    ) external {
        require(amount > 0, "amount must be > 0");

        uint outcomeSlotCount = payoutNumerators[conditionId].length;
        require(outcomeSlotCount > 0, "condition not prepared");

        // 验证 partition 是所有 outcome slot 的有效分区
        // 要求：各 indexSet 互不相交，且并集覆盖所有 slot
        uint fullIndexSet = (uint(1) << outcomeSlotCount) - 1;
        uint freeIndexSet = fullIndexSet;
        for (uint i = 0; i < partition.length; i++) {
            uint indexSet = partition[i];
            require(indexSet > 0 && indexSet <= fullIndexSet, "invalid indexSet");
            require((indexSet & freeIndexSet) == indexSet, "partition overlap");
            freeIndexSet ^= indexSet;
        }
        require(freeIndexSet == 0, "partition incomplete");

        // 顶层 split：从用户转入 USDC
        if (parentCollectionId == bytes32(0)) {
            collateralToken.safeTransferFrom(msg.sender, address(this), amount);
        } else {
            // 深层 split：烧掉父仓位 token
            uint parentPositionId = CTHelpers.getPositionId(
                address(collateralToken),
                parentCollectionId
            );
            _burn(msg.sender, parentPositionId, amount);
        }

        // 为每个分区铸出对应的 ERC1155 token
        for (uint i = 0; i < partition.length; i++) {
            bytes32 collectionId = CTHelpers.getCollectionId(
                parentCollectionId,
                conditionId,
                partition[i]
            );
            uint positionId = CTHelpers.getPositionId(
                address(collateralToken),
                collectionId
            );
            _mint(msg.sender, positionId, amount, "");
        }

        emit PositionSplit(msg.sender, collateralToken, parentCollectionId, conditionId, partition, amount);
    }

    // ── Step 4: 合并仓位 YES + NO → USDC（随时可退出）────────────────────

    function mergePositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint[] calldata partition,
        uint amount
    ) external {
        require(amount > 0, "amount must be > 0");

        uint outcomeSlotCount = payoutNumerators[conditionId].length;
        require(outcomeSlotCount > 0, "condition not prepared");

        uint fullIndexSet = (uint(1) << outcomeSlotCount) - 1;
        uint freeIndexSet = fullIndexSet;
        for (uint i = 0; i < partition.length; i++) {
            uint indexSet = partition[i];
            require(indexSet > 0 && indexSet <= fullIndexSet, "invalid indexSet");
            require((indexSet & freeIndexSet) == indexSet, "partition overlap");
            freeIndexSet ^= indexSet;
        }
        require(freeIndexSet == 0, "partition incomplete");

        // 烧掉每个分区的 token
        for (uint i = 0; i < partition.length; i++) {
            bytes32 collectionId = CTHelpers.getCollectionId(
                parentCollectionId,
                conditionId,
                partition[i]
            );
            uint positionId = CTHelpers.getPositionId(
                address(collateralToken),
                collectionId
            );
            _burn(msg.sender, positionId, amount);
        }

        // 返还 USDC（或铸出父仓位 token）
        if (parentCollectionId == bytes32(0)) {
            collateralToken.safeTransfer(msg.sender, amount);
        } else {
            uint parentPositionId = CTHelpers.getPositionId(
                address(collateralToken),
                parentCollectionId
            );
            _mint(msg.sender, parentPositionId, amount, "");
        }

        emit PositionsMerge(msg.sender, collateralToken, parentCollectionId, conditionId, partition, amount);
    }

    // ── Step 5: Oracle 上报结果 ──────────────────────────────────────────

    /**
     * msg.sender 必须是 prepareCondition 时指定的 oracle
     * @param payouts YES 赢传 [1,0]，NO 赢传 [0,1]，平局传 [1,1]
     */
    function reportPayouts(bytes32 questionId, uint[] calldata payouts) external {
        uint outcomeSlotCount = payouts.length;
        require(outcomeSlotCount > 1, "need at least 2 outcomes");

        // msg.sender 即 oracle，conditionId 由此推算
        bytes32 conditionId = CTHelpers.getConditionId(
            msg.sender,
            questionId,
            outcomeSlotCount
        );

        require(payoutNumerators[conditionId].length == outcomeSlotCount, "condition not prepared");
        require(payoutDenominator[conditionId] == 0, "already resolved");

        uint den = 0;
        for (uint i = 0; i < outcomeSlotCount; i++) {
            den += payouts[i];
            payoutNumerators[conditionId][i] = payouts[i];
        }
        require(den > 0, "all zero payout");
        payoutDenominator[conditionId] = den;

        emit ConditionResolution(conditionId, msg.sender, questionId, outcomeSlotCount, payouts);
    }

    // ── Step 6: 赢家取钱 ─────────────────────────────────────────────────

    /**
     * 赢家调用，按 payoutNumerators 比例获得 USDC
     * YES 赢且持有 100 YES token → 获得 100 USDC
     * NO  输且持有 100 NO  token → 获得 0 USDC，token 被烧掉
     */
    function redeemPositions(
        IERC20 collateralToken,
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint[] calldata indexSets
    ) external {
        uint den = payoutDenominator[conditionId];
        require(den > 0, "not resolved yet");

        uint outcomeSlotCount = payoutNumerators[conditionId].length;
        uint totalPayout = 0;

        for (uint i = 0; i < indexSets.length; i++) {
            uint indexSet = indexSets[i];
            require(indexSet > 0 && indexSet < (uint(1) << outcomeSlotCount), "invalid indexSet");

            // 计算这个 indexSet 对应的 payout 比例
            uint payoutNumerator = 0;
            for (uint j = 0; j < outcomeSlotCount; j++) {
                if (indexSet & (uint(1) << j) != 0) {
                    payoutNumerator += payoutNumerators[conditionId][j];
                }
            }

            bytes32 collectionId = CTHelpers.getCollectionId(
                parentCollectionId,
                conditionId,
                indexSet
            );
            uint positionId = CTHelpers.getPositionId(
                address(collateralToken),
                collectionId
            );

            uint balance = balanceOf(msg.sender, positionId);
            if (balance > 0) {
                _burn(msg.sender, positionId, balance);
                totalPayout += (balance * payoutNumerator) / den;
            }
        }

        if (totalPayout > 0) {
            if (parentCollectionId == bytes32(0)) {
                collateralToken.safeTransfer(msg.sender, totalPayout);
            } else {
                uint parentPositionId = CTHelpers.getPositionId(
                    address(collateralToken),
                    parentCollectionId
                );
                _mint(msg.sender, parentPositionId, totalPayout, "");
            }
        }

        emit PayoutRedemption(msg.sender, collateralToken, parentCollectionId, conditionId, indexSets, totalPayout);
    }

    // ── 只读工具函数 ─────────────────────────────────────────────────────

    function getConditionId(address oracle, bytes32 questionId, uint outcomeSlotCount)
        external pure returns (bytes32)
    {
        return CTHelpers.getConditionId(oracle, questionId, outcomeSlotCount);
    }

    function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint indexSet)
        external pure returns (bytes32)
    {
        return CTHelpers.getCollectionId(parentCollectionId, conditionId, indexSet);
    }

    function getPositionId(address collateralToken, bytes32 collectionId)
        external pure returns (uint256)
    {
        return CTHelpers.getPositionId(collateralToken, collectionId);
    }

    function getPayouts(bytes32 conditionId) external view returns (uint256[] memory) {
        return payoutNumerators[conditionId];
    }

    function getOutcomeSlotCount(bytes32 conditionId) external view returns (uint) {
        return payoutNumerators[conditionId].length;
    }
}
