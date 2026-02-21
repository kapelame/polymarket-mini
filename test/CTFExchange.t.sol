// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/core/ConditionalTokens.sol";
import "../src/core/MockUSDC.sol";
import "../src/exchange/CTFExchange.sol";
import "../src/exchange/OrderStructs.sol";

contract CTFExchangeTest is Test {

    ConditionalTokens ctf;
    MockUSDC usdc;
    CTFExchange exchange;

    address oracle   = makeAddr("oracle");
    address alice    = makeAddr("alice");
    address bob      = makeAddr("bob");
    address operator = makeAddr("operator");

    uint256 aliceKey = 0xA11CE;
    uint256 bobKey   = 0xB0B;

    bytes32 constant PARENT = bytes32(0);

    bytes32 questionId;
    bytes32 conditionId;
    uint256 yesTokenId;
    uint256 noTokenId;

    function setUp() public {
        // Use key-derived addresses so we can sign
        alice = vm.addr(aliceKey);
        bob   = vm.addr(bobKey);

        usdc     = new MockUSDC();
        ctf      = new ConditionalTokens();
        exchange = new CTFExchange(address(usdc), address(ctf), operator);

        // Fund alice and bob
        usdc.mint(alice, 1000e6);
        usdc.mint(bob,   1000e6);

        // Prepare condition
        questionId = keccak256("Will ETH hit $10k in 2025?");
        vm.prank(oracle);
        ctf.prepareCondition(oracle, questionId, 2);

        conditionId = ctf.getConditionId(oracle, questionId, 2);

        bytes32 yesCollId = ctf.getCollectionId(PARENT, conditionId, 1);
        bytes32 noCollId  = ctf.getCollectionId(PARENT, conditionId, 2);
        yesTokenId = ctf.getPositionId(address(usdc), yesCollId);
        noTokenId  = ctf.getPositionId(address(usdc), noCollId);

        // Give alice some YES tokens (simulate she bought them earlier)
        // alice splits 100 USDC -> 100 YES + 100 NO
        vm.startPrank(alice);
        usdc.approve(address(ctf), 100e6);
        uint[] memory partition = new uint[](2);
        partition[0] = 1;
        partition[1] = 2;
        ctf.splitPosition(usdc, PARENT, conditionId, partition, 100e6);
        // alice approves exchange to move her YES tokens
        ctf.setApprovalForAll(address(exchange), true);
        vm.stopPrank();

        // bob approves exchange to spend his USDC
        vm.prank(bob);
        usdc.approve(address(exchange), type(uint256).max);
    }

    // Build and sign an order
    function _buildOrder(
        uint256 signerKey,
        uint256 tokenId,
        Side side,
        uint256 makerAmount,
        uint256 takerAmount,
        uint256 salt
    ) internal view returns (Order memory order) {
        address signer = vm.addr(signerKey);
        order = Order({
            salt:          salt,
            maker:         signer,
            signer:        signer,
            taker:         address(0),
            tokenId:       tokenId,
            makerAmount:   makerAmount,
            takerAmount:   takerAmount,
            expiration:    0,
            nonce:         0,
            feeRateBps:    0,
            side:          side,
            signatureType: SignatureType.EOA,
            signature:     ""
        });

        bytes32 hash = exchange.getOrderHash(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        order.signature = abi.encodePacked(r, s, v);
    }

    // ── Test 1: Direct swap (SELL maker, BUY taker) ───────────────────────

    function test_Match_SellMaker_BuyTaker() public {
        // Alice SELLS 50 YES tokens for 30 USDC (price = 0.60)
        Order memory makerOrder = _buildOrder(
            aliceKey,
            yesTokenId,
            Side.SELL,
            50e6,   // makerAmount: 50 YES tokens to sell
            30e6,   // takerAmount: wants 30 USDC back
            1
        );

        // Bob BUYS 50 YES tokens, pays 30 USDC
        Order memory takerOrder = _buildOrder(
            bobKey,
            yesTokenId,
            Side.BUY,
            30e6,   // makerAmount: 30 USDC to spend
            50e6,   // takerAmount: wants 50 YES tokens
            2
        );

        // Register both orders
        vm.prank(alice);
        exchange.registerOrder(makerOrder);
        vm.prank(bob);
        exchange.registerOrder(takerOrder);

        uint aliceUsdcBefore = usdc.balanceOf(alice);
        uint bobYesBefore    = ctf.balanceOf(bob, yesTokenId);

        // Operator matches them
        vm.prank(operator);
        exchange.matchOrders(makerOrder, takerOrder, 50e6, 30e6);

        // Alice: lost 50 YES, gained 30 USDC
        assertEq(ctf.balanceOf(alice, yesTokenId), 100e6 - 50e6);
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore + 30e6);

        // Bob: lost 30 USDC, gained 50 YES
        assertEq(ctf.balanceOf(bob, yesTokenId), bobYesBefore + 50e6);
        assertEq(usdc.balanceOf(bob), 1000e6 - 30e6);
    }

    // ── Test 2: Signature validation ──────────────────────────────────────

    function test_Revert_InvalidSignature() public {
        Order memory makerOrder = _buildOrder(aliceKey, yesTokenId, Side.SELL, 50e6, 30e6, 1);
        Order memory takerOrder = _buildOrder(bobKey,   yesTokenId, Side.BUY,  30e6, 50e6, 2);

        // Tamper with the order after signing
        makerOrder.makerAmount = 999e6;

        vm.prank(alice);
        vm.expectRevert();
        exchange.registerOrder(makerOrder);
    }

    // ── Test 3: Order cancellation ────────────────────────────────────────

    function test_CancelOrder() public {
        Order memory makerOrder = _buildOrder(aliceKey, yesTokenId, Side.SELL, 50e6, 30e6, 1);
        Order memory takerOrder = _buildOrder(bobKey,   yesTokenId, Side.BUY,  30e6, 50e6, 2);

        vm.prank(alice);
        exchange.registerOrder(makerOrder);
        vm.prank(bob);
        exchange.registerOrder(takerOrder);

        // Alice cancels her order
        vm.prank(alice);
        exchange.cancelOrder(makerOrder);

        // Operator tries to match — should fail
        vm.prank(operator);
        vm.expectRevert("order filled or cancelled");
        exchange.matchOrders(makerOrder, takerOrder, 50e6, 30e6);
    }

    // ── Test 4: Only operator can match ───────────────────────────────────

    function test_Revert_NotOperator() public {
        Order memory makerOrder = _buildOrder(aliceKey, yesTokenId, Side.SELL, 50e6, 30e6, 1);
        Order memory takerOrder = _buildOrder(bobKey,   yesTokenId, Side.BUY,  30e6, 50e6, 2);

        vm.prank(alice);
        exchange.registerOrder(makerOrder);
        vm.prank(bob);
        exchange.registerOrder(takerOrder);

        vm.prank(alice); // alice is not operator
        vm.expectRevert("only operator");
        exchange.matchOrders(makerOrder, takerOrder, 50e6, 30e6);
    }

    // ── Test 5: Expired order ─────────────────────────────────────────────

    function test_Revert_ExpiredOrder() public {
        vm.warp(1000);
        address signer = vm.addr(aliceKey);
        Order memory makerOrder = Order({
            salt:          1,
            maker:         signer,
            signer:        signer,
            taker:         address(0),
            tokenId:       yesTokenId,
            makerAmount:   50e6,
            takerAmount:   30e6,
            expiration:    999, // already expired (< block.timestamp)
            nonce:         0,
            feeRateBps:    0,
            side:          Side.SELL,
            signatureType: SignatureType.EOA,
            signature:     ""
        });
        bytes32 hash = exchange.getOrderHash(makerOrder);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(aliceKey, hash);
        makerOrder.signature = abi.encodePacked(r, s, v);

        Order memory takerOrder = _buildOrder(bobKey, yesTokenId, Side.BUY, 30e6, 50e6, 2);

        vm.prank(alice);
        exchange.registerOrder(makerOrder);
        vm.prank(bob);
        exchange.registerOrder(takerOrder);

        vm.prank(operator);
        vm.expectRevert("order expired");
        exchange.matchOrders(makerOrder, takerOrder, 50e6, 30e6);
    }
}
