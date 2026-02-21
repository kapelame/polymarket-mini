// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title CTHelpers
 * @notice Polymarket 所有 token ID 的计算逻辑
 *
 * 三层 ID 推导链：
 *   questionId   (问题标识)
 *       ↓ keccak256(oracle, questionId, outcomeSlotCount)
 *   conditionId  (条件ID)
 *       ↓ keccak256(parentCollectionId, conditionId, indexSet)
 *   collectionId (集合ID)
 *       ↓ keccak256(collateralToken, collectionId)
 *   positionId   (ERC1155 tokenId，就是 YES/NO token 的 ID)
 *
 * 二元市场 indexSet：
 *   YES = 0b01 = 1
 *   NO  = 0b10 = 2
 */
library CTHelpers {

    function getConditionId(
        address oracle,
        bytes32 questionId,
        uint outcomeSlotCount
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(oracle, questionId, outcomeSlotCount));
    }

    function getCollectionId(
        bytes32 parentCollectionId,
        bytes32 conditionId,
        uint indexSet
    ) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked(parentCollectionId, conditionId, indexSet));
    }

    function getPositionId(
        address collateralToken,
        bytes32 collectionId
    ) internal pure returns (uint256) {
        return uint256(keccak256(abi.encodePacked(collateralToken, collectionId)));
    }
}
