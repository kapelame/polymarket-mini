// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Which side of the market
enum Side { BUY, SELL }

// How the order was signed
enum SignatureType { EOA, POLY_PROXY, POLY_GNOSIS_SAFE }

struct Order {
    uint256 salt;           // random, prevents duplicate order hashes
    address maker;          // who created the order
    address signer;         // who signed it (can differ with proxy wallets)
    address taker;          // specific counterparty, address(0) = anyone
    uint256 tokenId;        // ERC1155 positionId (YES or NO token)
    uint256 makerAmount;    // what maker gives up
    uint256 takerAmount;    // what maker wants in return
    uint256 expiration;     // unix timestamp, 0 = never expires
    uint256 nonce;          // for on-chain cancellation
    uint256 feeRateBps;     // fee in basis points (100 bps = 1%)
    Side side;              // BUY or SELL
    SignatureType signatureType;
    bytes signature;
}

// Tracks fill state of each order
struct OrderStatus {
    bool isFilledOrCancelled;
    uint256 remaining; // how many tokens still available to fill
}
