// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC1155/utils/ERC1155Holder.sol";
import "./OrderStructs.sol";
import "../core/ConditionalTokens.sol";
import "../libraries/CTHelpers.sol";

contract CTFExchange is ReentrancyGuard, ERC1155Holder {
    using SafeERC20 for IERC20;
    using ECDSA for bytes32;

    IERC20 public immutable collateral;
    ConditionalTokens public immutable ctf;
    address public operator;

    mapping(bytes32 => OrderStatus) public orderStatus;

    struct TokenMetadata {
        bytes32 conditionId;
        uint    indexSet;
        bool    registered;
    }
    mapping(uint256 => TokenMetadata) public tokenRegistry;

    bytes32 public immutable DOMAIN_SEPARATOR;

    bytes32 constant ORDER_TYPEHASH = keccak256(
        "Order(uint256 salt,address maker,address signer,address taker,"
        "uint256 tokenId,uint256 makerAmount,uint256 takerAmount,"
        "uint256 expiration,uint256 nonce,uint256 feeRateBps,"
        "uint8 side,uint8 signatureType)"
    );

    event OrderFilled(
        bytes32 indexed orderHash,
        address indexed maker,
        address indexed taker,
        uint256 makerAmountFilled,
        uint256 takerAmountFilled
    );
    event OrderCancelled(bytes32 indexed orderHash);
    event TokenRegistered(uint256 indexed tokenId, bytes32 conditionId, uint indexSet);

    constructor(address _collateral, address _ctf, address _operator) {
        collateral = IERC20(_collateral);
        ctf        = ConditionalTokens(_ctf);
        operator   = _operator;

        DOMAIN_SEPARATOR = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("CTFExchange"),
            keccak256("1"),
            block.chainid,
            address(this)
        ));
    }

    // ── Token Registry ────────────────────────────────────────────────────

    function registerToken(bytes32 conditionId, uint indexSet) external {
        bytes32 collectionId = CTHelpers.getCollectionId(bytes32(0), conditionId, indexSet);
        uint256 tokenId      = CTHelpers.getPositionId(address(collateral), collectionId);

        require(!tokenRegistry[tokenId].registered, "already registered");
        require(ctf.getOutcomeSlotCount(conditionId) > 0, "condition not prepared");

        tokenRegistry[tokenId] = TokenMetadata({
            conditionId: conditionId,
            indexSet:    indexSet,
            registered:  true
        });

        emit TokenRegistered(tokenId, conditionId, indexSet);
    }

    // ── Order Hashing ─────────────────────────────────────────────────────

    function getOrderHash(Order memory order) public view returns (bytes32) {
        bytes32 structHash = keccak256(abi.encode(
            ORDER_TYPEHASH,
            order.salt, order.maker, order.signer, order.taker,
            order.tokenId, order.makerAmount, order.takerAmount,
            order.expiration, order.nonce, order.feeRateBps,
            order.side, order.signatureType
        ));
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
    }

    function _verifySignature(Order memory order, bytes32 orderHash) internal pure {
        address recovered = orderHash.recover(order.signature);
        require(recovered == order.signer, "invalid signature");
        require(order.signer == order.maker, "signer must be maker");
    }

    // ── Order Management ──────────────────────────────────────────────────

    function registerOrder(Order memory order) external {
        bytes32 orderHash = getOrderHash(order);
        require(order.maker == msg.sender, "not your order");
        require(orderStatus[orderHash].remaining == 0, "already registered");
        _verifySignature(order, orderHash);
        orderStatus[orderHash].remaining = order.makerAmount;
    }

    function cancelOrder(Order memory order) external {
        bytes32 orderHash = getOrderHash(order);
        require(order.maker == msg.sender, "not your order");
        orderStatus[orderHash].isFilledOrCancelled = true;
        emit OrderCancelled(orderHash);
    }

    // ── Match: direct swap (BUY vs SELL, same token) ──────────────────────

    function matchOrders(
        Order memory makerOrder,
        Order memory takerOrder,
        uint256 makerFillAmount,
        uint256 takerFillAmount
    ) external nonReentrant {
        require(msg.sender == operator, "only operator");

        bytes32 makerHash = getOrderHash(makerOrder);
        bytes32 takerHash = getOrderHash(takerOrder);

        _validateOrder(makerOrder, makerHash, makerFillAmount);
        _validateOrder(takerOrder, takerHash, takerFillAmount);
        require(makerOrder.side != takerOrder.side, "same side");

        _settle(makerOrder, takerOrder, makerFillAmount, takerFillAmount);

        orderStatus[makerHash].remaining -= makerFillAmount;
        orderStatus[takerHash].remaining -= takerFillAmount;

        emit OrderFilled(makerHash, makerOrder.maker, takerOrder.maker, makerFillAmount, takerFillAmount);
        emit OrderFilled(takerHash, takerOrder.maker, makerOrder.maker, takerFillAmount, makerFillAmount);
    }

    // ── Match: mint (both BUY complementary tokens, no pre-existing liquidity) ──

    function matchComplementaryOrders(
        Order memory makerOrder,
        Order memory takerOrder,
        uint256 usdcAmount
    ) external nonReentrant {
        require(msg.sender == operator, "only operator");

        bytes32 makerHash = getOrderHash(makerOrder);
        bytes32 takerHash = getOrderHash(takerOrder);

        _validateOrder(makerOrder, makerHash, usdcAmount);
        _validateOrder(takerOrder, takerHash, usdcAmount);

        require(makerOrder.side == Side.BUY, "maker must BUY");
        require(takerOrder.side == Side.BUY, "taker must BUY");
        require(makerOrder.tokenId != takerOrder.tokenId, "same token");

        TokenMetadata memory makerMeta = tokenRegistry[makerOrder.tokenId];
        TokenMetadata memory takerMeta = tokenRegistry[takerOrder.tokenId];
        require(makerMeta.registered && takerMeta.registered, "token not registered");
        require(makerMeta.conditionId == takerMeta.conditionId, "different conditions");

        uint outcomeSlotCount = ctf.getOutcomeSlotCount(makerMeta.conditionId);
        uint fullSet = (uint(1) << outcomeSlotCount) - 1;
        require((makerMeta.indexSet | takerMeta.indexSet) == fullSet, "not complementary");
        require((makerMeta.indexSet & takerMeta.indexSet) == 0, "overlapping indexSets");

        _settleMint(makerOrder, takerOrder, makerMeta, takerMeta, usdcAmount);

        orderStatus[makerHash].remaining -= usdcAmount;
        orderStatus[takerHash].remaining -= usdcAmount;

        emit OrderFilled(makerHash, makerOrder.maker, takerOrder.maker, usdcAmount, usdcAmount);
        emit OrderFilled(takerHash, takerOrder.maker, makerOrder.maker, usdcAmount, usdcAmount);
    }

    // ── Match: merge (both SELL complementary tokens, get USDC back) ──────

    function matchComplementarySellOrders(
        Order memory makerOrder,
        Order memory takerOrder,
        uint256 tokenAmount
    ) external nonReentrant {
        require(msg.sender == operator, "only operator");

        bytes32 makerHash = getOrderHash(makerOrder);
        bytes32 takerHash = getOrderHash(takerOrder);

        _validateOrder(makerOrder, makerHash, tokenAmount);
        _validateOrder(takerOrder, takerHash, tokenAmount);

        require(makerOrder.side == Side.SELL, "maker must SELL");
        require(takerOrder.side == Side.SELL, "taker must SELL");
        require(makerOrder.tokenId != takerOrder.tokenId, "same token");

        TokenMetadata memory makerMeta = tokenRegistry[makerOrder.tokenId];
        TokenMetadata memory takerMeta = tokenRegistry[takerOrder.tokenId];
        require(makerMeta.registered && takerMeta.registered, "token not registered");
        require(makerMeta.conditionId == takerMeta.conditionId, "different conditions");

        uint outcomeSlotCount = ctf.getOutcomeSlotCount(makerMeta.conditionId);
        uint fullSet = (uint(1) << outcomeSlotCount) - 1;
        require((makerMeta.indexSet | takerMeta.indexSet) == fullSet, "not complementary");
        require((makerMeta.indexSet & takerMeta.indexSet) == 0, "overlapping indexSets");

        require(
            makerOrder.takerAmount + takerOrder.takerAmount == tokenAmount,
            "usdc amounts must sum to tokenAmount"
        );

        _settleMerge(makerOrder, takerOrder, makerMeta, takerMeta, tokenAmount);

        orderStatus[makerHash].remaining -= tokenAmount;
        orderStatus[takerHash].remaining -= tokenAmount;

        emit OrderFilled(makerHash, makerOrder.maker, takerOrder.maker, tokenAmount, tokenAmount);
        emit OrderFilled(takerHash, takerOrder.maker, makerOrder.maker, tokenAmount, tokenAmount);
    }

    // ── Internal: Validation ──────────────────────────────────────────────

    function _validateOrder(
        Order memory order,
        bytes32 orderHash,
        uint256 fillAmount
    ) internal view {
        require(!orderStatus[orderHash].isFilledOrCancelled, "order filled or cancelled");
        require(fillAmount > 0, "fill amount must be > 0");
        require(fillAmount <= orderStatus[orderHash].remaining, "exceeds remaining");
        if (order.expiration != 0) {
            require(block.timestamp < order.expiration, "order expired");
        }
        _verifySignature(order, orderHash);
    }

    // ── Internal: Settlement ──────────────────────────────────────────────

    function _settle(
        Order memory makerOrder,
        Order memory takerOrder,
        uint256 makerFill,
        uint256 takerFill
    ) internal {
        if (makerOrder.side == Side.SELL && takerOrder.side == Side.BUY) {
            collateral.safeTransferFrom(takerOrder.maker, makerOrder.maker, takerFill);
            ctf.safeTransferFrom(makerOrder.maker, takerOrder.maker, makerOrder.tokenId, makerFill, "");
        } else {
            collateral.safeTransferFrom(makerOrder.maker, takerOrder.maker, makerFill);
            ctf.safeTransferFrom(takerOrder.maker, makerOrder.maker, takerOrder.tokenId, takerFill, "");
        }
    }

    function _settleMint(
        Order memory makerOrder,
        Order memory takerOrder,
        TokenMetadata memory makerMeta,
        TokenMetadata memory takerMeta,
        uint256 usdcAmount
    ) internal {
        uint256 totalUsdc = usdcAmount * 2;

        collateral.safeTransferFrom(makerOrder.maker, address(this), usdcAmount);
        collateral.safeTransferFrom(takerOrder.maker, address(this), usdcAmount);
        collateral.approve(address(ctf), totalUsdc);

        uint[] memory partition = new uint[](2);
        partition[0] = makerMeta.indexSet;
        partition[1] = takerMeta.indexSet;

        ctf.splitPosition(collateral, bytes32(0), makerMeta.conditionId, partition, totalUsdc);

        ctf.safeTransferFrom(address(this), makerOrder.maker, makerOrder.tokenId, totalUsdc, "");
        ctf.safeTransferFrom(address(this), takerOrder.maker, takerOrder.tokenId, totalUsdc, "");
    }

    function _settleMerge(
        Order memory makerOrder,
        Order memory takerOrder,
        TokenMetadata memory makerMeta,
        TokenMetadata memory takerMeta,
        uint256 tokenAmount
    ) internal {
        ctf.safeTransferFrom(makerOrder.maker, address(this), makerOrder.tokenId, tokenAmount, "");
        ctf.safeTransferFrom(takerOrder.maker, address(this), takerOrder.tokenId, tokenAmount, "");

        uint[] memory partition = new uint[](2);
        partition[0] = makerMeta.indexSet;
        partition[1] = takerMeta.indexSet;

        ctf.mergePositions(collateral, bytes32(0), makerMeta.conditionId, partition, tokenAmount);

        collateral.safeTransfer(makerOrder.maker, makerOrder.takerAmount);
        collateral.safeTransfer(takerOrder.maker, takerOrder.takerAmount);
    }
}
