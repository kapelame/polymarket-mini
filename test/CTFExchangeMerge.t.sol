// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/core/ConditionalTokens.sol";
import "../src/core/MockUSDC.sol";
import "../src/exchange/CTFExchange.sol";
import "../src/exchange/OrderStructs.sol";

contract CTFExchangeMergeTest is Test {

    ConditionalTokens ctf;
    MockUSDC usdc;
    CTFExchange exchange;

    address oracle   = makeAddr("oracle");
    address operator = makeAddr("operator");

    uint256 aliceKey = 0xA11CE;
    uint256 bobKey   = 0xB0B;
    address alice;
    address bob;

    bytes32 constant PARENT = bytes32(0);
    bytes32 questionId;
    bytes32 conditionId;
    uint256 yesTokenId;
    uint256 noTokenId;

    function setUp() public {
        alice = vm.addr(aliceKey);
        bob   = vm.addr(bobKey);

        usdc     = new MockUSDC();
        ctf      = new ConditionalTokens();
        exchange = new CTFExchange(address(usdc), address(ctf), operator);

        usdc.mint(alice, 1000e6);
        usdc.mint(bob,   1000e6);

        questionId = keccak256("Will ETH hit $10k in 2025?");
        vm.prank(oracle);
        ctf.prepareCondition(oracle, questionId, 2);
        conditionId = ctf.getConditionId(oracle, questionId, 2);

        bytes32 yesCollId = ctf.getCollectionId(PARENT, conditionId, 1);
        bytes32 noCollId  = ctf.getCollectionId(PARENT, conditionId, 2);
        yesTokenId = ctf.getPositionId(address(usdc), yesCollId);
        noTokenId  = ctf.getPositionId(address(usdc), noCollId);

        exchange.registerToken(conditionId, 1);
        exchange.registerToken(conditionId, 2);

        // Alice splits 100 USDC → 100 YES + 100 NO
        // Alice keeps YES, gives NO to Bob
        uint[] memory partition = new uint[](2);
        partition[0] = 1;
        partition[1] = 2;

        vm.startPrank(alice);
        usdc.approve(address(ctf), 100e6);
        ctf.splitPosition(usdc, PARENT, conditionId, partition, 100e6);
        ctf.safeTransferFrom(alice, bob, noTokenId, 100e6, "");
        ctf.setApprovalForAll(address(exchange), true);
        vm.stopPrank();

        vm.prank(bob);
        ctf.setApprovalForAll(address(exchange), true);

        // State:
        //   Alice: 900 USDC, 100 YES, 0 NO
        //   Bob:   1000 USDC, 0 YES, 100 NO
        //   CTF:   100 USDC locked
    }

    // Build a SELL order: maker gives `tokenAmount` tokens, expects `usdcExpected` USDC back
    function _buildSellOrder(
        uint256 signerKey,
        uint256 tokenId,
        uint256 tokenAmount,
        uint256 usdcExpected,
        uint256 salt
    ) internal view returns (Order memory order) {
        address signer = vm.addr(signerKey);
        order = Order({
            salt:          salt,
            maker:         signer,
            signer:        signer,
            taker:         address(0),
            tokenId:       tokenId,
            makerAmount:   tokenAmount,  // tokens to give up
            takerAmount:   usdcExpected, // USDC to receive
            expiration:    0,
            nonce:         0,
            feeRateBps:    0,
            side:          Side.SELL,
            signatureType: SignatureType.EOA,
            signature:     ""
        });
        bytes32 hash = exchange.getOrderHash(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        order.signature = abi.encodePacked(r, s, v);
    }

    // ── Test 1: partial merge — each gets USDC proportional to their price ─

    function test_MergeSettlement_BothGetUSDC() public {
        // At $0.50 each: selling 60 tokens → 30 USDC back
        // Total unlocked: 60 USDC (30 + 30 = 60 = tokenAmount)
        Order memory aliceOrder = _buildSellOrder(aliceKey, yesTokenId, 60e6, 30e6, 1);
        Order memory bobOrder   = _buildSellOrder(bobKey,   noTokenId,  60e6, 30e6, 2);

        vm.prank(alice);
        exchange.registerOrder(aliceOrder);
        vm.prank(bob);
        exchange.registerOrder(bobOrder);

        vm.prank(operator);
        exchange.matchComplementarySellOrders(aliceOrder, bobOrder, 60e6);

        assertEq(usdc.balanceOf(alice), 900e6 + 30e6);  // 930
        assertEq(usdc.balanceOf(bob),   1000e6 + 30e6); // 1030
        assertEq(usdc.balanceOf(address(ctf)), 40e6);   // 100 - 60 = 40
        assertEq(usdc.balanceOf(address(exchange)), 0);
        assertEq(ctf.balanceOf(address(exchange), yesTokenId), 0);
        assertEq(ctf.balanceOf(address(exchange), noTokenId),  0);
    }

    // ── Test 2: full exit ─────────────────────────────────────────────────

    function test_MergeSettlement_FullExit() public {
        // Sell all 100 tokens at $0.50 = 50 USDC each
        Order memory aliceOrder = _buildSellOrder(aliceKey, yesTokenId, 100e6, 50e6, 1);
        Order memory bobOrder   = _buildSellOrder(bobKey,   noTokenId,  100e6, 50e6, 2);

        vm.prank(alice);
        exchange.registerOrder(aliceOrder);
        vm.prank(bob);
        exchange.registerOrder(bobOrder);

        vm.prank(operator);
        exchange.matchComplementarySellOrders(aliceOrder, bobOrder, 100e6);

        assertEq(usdc.balanceOf(alice), 950e6);  // 900 + 50
        assertEq(usdc.balanceOf(bob),   1050e6); // 1000 + 50
        assertEq(usdc.balanceOf(address(ctf)), 0);
        assertEq(ctf.balanceOf(alice, yesTokenId), 0);
        assertEq(ctf.balanceOf(bob,   noTokenId),  0);
    }

    // ── Test 3: revert same token ─────────────────────────────────────────

    function test_Revert_MergeSameToken() public {
        Order memory aliceOrder = _buildSellOrder(aliceKey, yesTokenId, 50e6, 25e6, 1);
        Order memory bobOrder   = _buildSellOrder(bobKey,   yesTokenId, 50e6, 25e6, 2);

        vm.prank(alice);
        exchange.registerOrder(aliceOrder);
        vm.prank(bob);
        exchange.registerOrder(bobOrder);

        vm.prank(operator);
        vm.expectRevert("same token");
        exchange.matchComplementarySellOrders(aliceOrder, bobOrder, 50e6);
    }

    // ── Test 4: revert if USDC amounts don't sum to tokenAmount ───────────

    function test_Revert_AmountsMismatch() public {
        // takerAmounts sum to 70, but tokenAmount is 60 — mismatch
        Order memory aliceOrder = _buildSellOrder(aliceKey, yesTokenId, 60e6, 40e6, 1);
        Order memory bobOrder   = _buildSellOrder(bobKey,   noTokenId,  60e6, 30e6, 2);

        vm.prank(alice);
        exchange.registerOrder(aliceOrder);
        vm.prank(bob);
        exchange.registerOrder(bobOrder);

        vm.prank(operator);
        vm.expectRevert("usdc amounts must sum to tokenAmount");
        exchange.matchComplementarySellOrders(aliceOrder, bobOrder, 60e6);
    }
}
