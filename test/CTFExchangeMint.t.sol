// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/core/ConditionalTokens.sol";
import "../src/core/MockUSDC.sol";
import "../src/exchange/CTFExchange.sol";
import "../src/exchange/OrderStructs.sol";

contract CTFExchangeMintTest is Test {

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

        // Prepare condition
        questionId  = keccak256("Will ETH hit $10k in 2025?");
        vm.prank(oracle);
        ctf.prepareCondition(oracle, questionId, 2);
        conditionId = ctf.getConditionId(oracle, questionId, 2);

        // Compute token IDs
        bytes32 yesCollId = ctf.getCollectionId(PARENT, conditionId, 1);
        bytes32 noCollId  = ctf.getCollectionId(PARENT, conditionId, 2);
        yesTokenId = ctf.getPositionId(address(usdc), yesCollId);
        noTokenId  = ctf.getPositionId(address(usdc), noCollId);

        // Register tokens in exchange
        exchange.registerToken(conditionId, 1); // YES
        exchange.registerToken(conditionId, 2); // NO

        // Exchange needs ERC1155 approval to transfer tokens it receives from split
        // The exchange calls splitPosition -> receives tokens -> transfers to users
        // Since exchange is the owner after split, it can transfer without extra approval

        // Alice and Bob approve exchange to spend their USDC
        vm.prank(alice);
        usdc.approve(address(exchange), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(exchange), type(uint256).max);
    }

    function _buildBuyOrder(
        uint256 signerKey,
        uint256 tokenId,
        uint256 usdcAmount,  // how much USDC to spend
        uint256 tokenAmount, // how many tokens expected back
        uint256 salt
    ) internal view returns (Order memory order) {
        address signer = vm.addr(signerKey);
        order = Order({
            salt:          salt,
            maker:         signer,
            signer:        signer,
            taker:         address(0),
            tokenId:       tokenId,
            makerAmount:   usdcAmount,
            takerAmount:   tokenAmount,
            expiration:    0,
            nonce:         0,
            feeRateBps:    0,
            side:          Side.BUY,
            signatureType: SignatureType.EOA,
            signature:     ""
        });
        bytes32 hash = exchange.getOrderHash(order);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(signerKey, hash);
        order.signature = abi.encodePacked(r, s, v);
    }

    // ── Test 1: Mint settlement — no pre-existing tokens needed ───────────

    function test_MintSettlement_NoPreexistingTokens() public {
        // Alice wants to BUY 50 YES, pays 50 USDC (price = $1.00 simplified)
        Order memory aliceOrder = _buildBuyOrder(aliceKey, yesTokenId, 50e6, 50e6, 1);
        // Bob wants to BUY 50 NO, pays 50 USDC
        Order memory bobOrder   = _buildBuyOrder(bobKey,   noTokenId,  50e6, 50e6, 2);

        vm.prank(alice);
        exchange.registerOrder(aliceOrder);
        vm.prank(bob);
        exchange.registerOrder(bobOrder);

        uint aliceUsdcBefore = usdc.balanceOf(alice);
        uint bobUsdcBefore   = usdc.balanceOf(bob);

        // No YES or NO tokens exist yet — operator mints them atomically
        assertEq(ctf.balanceOf(alice, yesTokenId), 0);
        assertEq(ctf.balanceOf(bob,   noTokenId),  0);
        assertEq(usdc.balanceOf(address(ctf)),      0);

        vm.prank(operator);
        exchange.matchComplementaryOrders(aliceOrder, bobOrder, 50e6);

        // Alice paid 50 USDC, received 50 YES tokens
        assertEq(usdc.balanceOf(alice),             aliceUsdcBefore - 50e6);
        assertEq(ctf.balanceOf(alice, yesTokenId),  100e6);

        // Bob paid 50 USDC, received 50 NO tokens
        assertEq(usdc.balanceOf(bob),               bobUsdcBefore - 50e6);
        assertEq(ctf.balanceOf(bob, noTokenId),     100e6);

        // 100 USDC locked in CTF (backs all outstanding tokens)
        assertEq(usdc.balanceOf(address(ctf)),      100e6);

        // Exchange holds no leftover tokens or USDC
        assertEq(usdc.balanceOf(address(exchange)),          0);
        assertEq(ctf.balanceOf(address(exchange), yesTokenId), 0);
        assertEq(ctf.balanceOf(address(exchange), noTokenId),  0);
    }

    // ── Test 2: Revert if tokens are same (not complementary) ─────────────

    function test_Revert_SameToken() public {
        // Both try to buy YES
        Order memory aliceOrder = _buildBuyOrder(aliceKey, yesTokenId, 50e6, 50e6, 1);
        Order memory bobOrder   = _buildBuyOrder(bobKey,   yesTokenId, 50e6, 50e6, 2);

        vm.prank(alice);
        exchange.registerOrder(aliceOrder);
        vm.prank(bob);
        exchange.registerOrder(bobOrder);

        vm.prank(operator);
        vm.expectRevert("same token");
        exchange.matchComplementaryOrders(aliceOrder, bobOrder, 50e6);
    }

    // ── Test 3: Revert if token not registered ────────────────────────────

    function test_Revert_TokenNotRegistered() public {
        // Create a fake tokenId that was never registered
        uint256 fakeTokenId = 999;
        Order memory aliceOrder = _buildBuyOrder(aliceKey, fakeTokenId, 50e6, 50e6, 1);
        Order memory bobOrder   = _buildBuyOrder(bobKey,   noTokenId,   50e6, 50e6, 2);

        vm.prank(alice);
        exchange.registerOrder(aliceOrder);
        vm.prank(bob);
        exchange.registerOrder(bobOrder);

        vm.prank(operator);
        vm.expectRevert("token not registered");
        exchange.matchComplementaryOrders(aliceOrder, bobOrder, 50e6);
    }

    // ── Test 4: Partial fill — mint only what's needed ────────────────────

    function test_MintSettlement_PartialFill() public {
        // Alice wants 100 YES, Bob wants 100 NO — but only 30 USDC matched
        Order memory aliceOrder = _buildBuyOrder(aliceKey, yesTokenId, 100e6, 100e6, 1);
        Order memory bobOrder   = _buildBuyOrder(bobKey,   noTokenId,  100e6, 100e6, 2);

        vm.prank(alice);
        exchange.registerOrder(aliceOrder);
        vm.prank(bob);
        exchange.registerOrder(bobOrder);

        vm.prank(operator);
        exchange.matchComplementaryOrders(aliceOrder, bobOrder, 30e6); // only 30 matched

        assertEq(ctf.balanceOf(alice, yesTokenId), 60e6);
        assertEq(ctf.balanceOf(bob,   noTokenId),  60e6);
        assertEq(usdc.balanceOf(address(ctf)),     60e6); // 30+30

        // Orders still have remaining capacity
        bytes32 aliceHash = exchange.getOrderHash(aliceOrder);
        (, uint256 remaining) = exchange.orderStatus(aliceHash);
        assertEq(remaining, 70e6);
    }
}
