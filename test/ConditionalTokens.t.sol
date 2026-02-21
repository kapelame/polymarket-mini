// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/core/ConditionalTokens.sol";
import "../src/core/MockUSDC.sol";

contract ConditionalTokensTest is Test {

    ConditionalTokens ctf;
    MockUSDC usdc;

    address oracle = makeAddr("oracle");
    address alice  = makeAddr("alice");
    address bob    = makeAddr("bob");

    bytes32 constant PARENT = bytes32(0);
    uint constant YES = 1;
    uint constant NO  = 2;

    bytes32 questionId;
    bytes32 conditionId;
    uint256 yesTokenId;
    uint256 noTokenId;

    function setUp() public {
        usdc = new MockUSDC();
        ctf  = new ConditionalTokens();

        usdc.mint(alice, 100e6);
        usdc.mint(bob,   100e6);

        questionId = keccak256("Will ETH hit $10k in 2025?");

        vm.prank(oracle);
        ctf.prepareCondition(oracle, questionId, 2);

        conditionId = ctf.getConditionId(oracle, questionId, 2);

        bytes32 yesCollId = ctf.getCollectionId(PARENT, conditionId, YES);
        bytes32 noCollId  = ctf.getCollectionId(PARENT, conditionId, NO);
        yesTokenId = ctf.getPositionId(address(usdc), yesCollId);
        noTokenId  = ctf.getPositionId(address(usdc), noCollId);
    }

    function test_PrepareCondition() public view {
        assertEq(ctf.getOutcomeSlotCount(conditionId), 2);
    }

    function test_PrepareCondition_Revert_AlreadyPrepared() public {
        vm.prank(oracle);
        vm.expectRevert("already prepared");
        ctf.prepareCondition(oracle, questionId, 2);
    }

    function test_PrepareCondition_Revert_TooFewOutcomes() public {
        vm.prank(oracle);
        vm.expectRevert("need at least 2 outcomes");
        ctf.prepareCondition(oracle, keccak256("other"), 1);
    }

    function test_Split_AliceGetsTokens() public {
        uint amount = 60e6;

        uint[] memory partition = new uint[](2);
        partition[0] = YES;
        partition[1] = NO;

        vm.startPrank(alice);
        usdc.approve(address(ctf), amount);
        ctf.splitPosition(usdc, PARENT, conditionId, partition, amount);
        vm.stopPrank();

        assertEq(ctf.balanceOf(alice, yesTokenId), amount);
        assertEq(ctf.balanceOf(alice, noTokenId),  amount);
        assertEq(usdc.balanceOf(alice),             100e6 - amount);
        assertEq(usdc.balanceOf(address(ctf)),      amount);
    }

    function test_Split_Revert_NoApproval() public {
        uint[] memory partition = new uint[](2);
        partition[0] = YES;
        partition[1] = NO;

        vm.prank(alice);
        vm.expectRevert();
        ctf.splitPosition(usdc, PARENT, conditionId, partition, 60e6);
    }

    function test_Merge_GetUsdcBack() public {
        uint amount = 40e6;

        uint[] memory partition = new uint[](2);
        partition[0] = YES;
        partition[1] = NO;

        vm.startPrank(bob);
        usdc.approve(address(ctf), amount);
        ctf.splitPosition(usdc, PARENT, conditionId, partition, amount);
        ctf.mergePositions(usdc, PARENT, conditionId, partition, amount);
        vm.stopPrank();

        assertEq(usdc.balanceOf(bob),          100e6);
        assertEq(ctf.balanceOf(bob, yesTokenId), 0);
        assertEq(ctf.balanceOf(bob, noTokenId),  0);
    }

    function test_FullFlow_YesWins() public {
        uint[] memory partition = new uint[](2);
        partition[0] = YES;
        partition[1] = NO;

        // Alice: split 60 USDC
        vm.startPrank(alice);
        usdc.approve(address(ctf), 60e6);
        ctf.splitPosition(usdc, PARENT, conditionId, partition, 60e6);
        vm.stopPrank();

        // Bob: split 40 USDC
        vm.startPrank(bob);
        usdc.approve(address(ctf), 40e6);
        ctf.splitPosition(usdc, PARENT, conditionId, partition, 40e6);
        vm.stopPrank();

        // Alice NO -> Bob, Bob YES -> Alice
        // 最终：Alice 持有 100 YES，Bob 持有 100 NO
        vm.prank(alice);
        ctf.safeTransferFrom(alice, bob,   noTokenId,  60e6, "");
        vm.prank(bob);
        ctf.safeTransferFrom(bob,   alice, yesTokenId, 40e6, "");

        assertEq(ctf.balanceOf(alice, yesTokenId), 100e6);
        assertEq(ctf.balanceOf(alice, noTokenId),  0);
        assertEq(ctf.balanceOf(bob,   yesTokenId), 0);
        assertEq(ctf.balanceOf(bob,   noTokenId),  100e6);
        assertEq(usdc.balanceOf(address(ctf)),     100e6);

        // Oracle: YES wins
        uint[] memory payouts = new uint[](2);
        payouts[0] = 1;
        payouts[1] = 0;
        vm.prank(oracle);
        ctf.reportPayouts(questionId, payouts);

        assertEq(ctf.payoutDenominator(conditionId),    1);
        assertEq(ctf.payoutNumerators(conditionId, 0),  1);
        assertEq(ctf.payoutNumerators(conditionId, 1),  0);

        // Alice redeems YES -> 100 USDC
        uint[] memory aliceIdx = new uint[](1);
        aliceIdx[0] = YES;
        vm.prank(alice);
        ctf.redeemPositions(usdc, PARENT, conditionId, aliceIdx);

        // Bob redeems NO -> 0 USDC
        uint[] memory bobIdx = new uint[](1);
        bobIdx[0] = NO;
        vm.prank(bob);
        ctf.redeemPositions(usdc, PARENT, conditionId, bobIdx);

        // Alice: started 100, spent 60, got back 100 -> 140
        assertEq(usdc.balanceOf(alice), 140e6);
        // Bob: started 100, spent 40, got back 0 -> 60
        assertEq(usdc.balanceOf(bob),   60e6);
        // contract empty
        assertEq(usdc.balanceOf(address(ctf)), 0);

        assertEq(ctf.balanceOf(alice, yesTokenId), 0);
        assertEq(ctf.balanceOf(bob,   noTokenId),  0);
    }

    function test_Redeem_Revert_BeforeResolution() public {
        uint[] memory partition = new uint[](2);
        partition[0] = YES;
        partition[1] = NO;

        vm.startPrank(alice);
        usdc.approve(address(ctf), 10e6);
        ctf.splitPosition(usdc, PARENT, conditionId, partition, 10e6);
        vm.stopPrank();

        uint[] memory indexSets = new uint[](1);
        indexSets[0] = YES;
        vm.prank(alice);
        vm.expectRevert("not resolved yet");
        ctf.redeemPositions(usdc, PARENT, conditionId, indexSets);
    }

    function test_ReportPayouts_Revert_WrongOracle() public {
        uint[] memory payouts = new uint[](2);
        payouts[0] = 1;
        payouts[1] = 0;
        vm.prank(alice);
        vm.expectRevert("condition not prepared");
        ctf.reportPayouts(questionId, payouts);
    }
}
