const { ethers } = require("ethers");

const ORDER_TYPEHASH = ethers.keccak256(ethers.toUtf8Bytes(
    "Order(uint256 salt,address maker,address signer,address taker," +
    "uint256 tokenId,uint256 makerAmount,uint256 takerAmount," +
    "uint256 expiration,uint256 nonce,uint256 feeRateBps," +
    "uint8 side,uint8 signatureType)"
));

function getDomainSeparator(chainId, exchangeAddress) {
    return ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "bytes32", "bytes32", "uint256", "address"],
        [
            ethers.keccak256(ethers.toUtf8Bytes("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)")),
            ethers.keccak256(ethers.toUtf8Bytes("CTFExchange")),
            ethers.keccak256(ethers.toUtf8Bytes("1")),
            chainId,
            exchangeAddress,
        ]
    ));
}

function getOrderHash(order, domainSeparator) {
    const structHash = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32","uint256","address","address","address","uint256","uint256","uint256","uint256","uint256","uint256","uint8","uint8"],
        [
            ORDER_TYPEHASH,
            order.salt,
            order.maker,
            order.signer,
            order.taker,
            order.tokenId,
            order.makerAmount,
            order.takerAmount,
            order.expiration,
            order.nonce,
            order.feeRateBps,
            order.side === "BUY" ? 0 : 1,
            order.signatureType || 0,
        ]
    ));
    return ethers.keccak256(
        ethers.concat(["0x1901", domainSeparator, structHash])
    );
}

function verifyOrderSignature(order, chainId, exchangeAddress) {
    if (!exchangeAddress || exchangeAddress === "0x0000000000000000000000000000000000000000") {
        return true;
    }
    const domainSeparator = getDomainSeparator(chainId, exchangeAddress);
    const orderHash       = getOrderHash(order, domainSeparator);
    const recovered       = ethers.recoverAddress(orderHash, order.signature);
    if (recovered.toLowerCase() !== order.signer.toLowerCase()) {
        throw new Error(`Invalid signature: expected ${order.signer}, got ${recovered}`);
    }
    if (order.signer.toLowerCase() !== order.maker.toLowerCase()) {
        throw new Error("Signer must be maker");
    }
    return true;
}

module.exports = { verifyOrderSignature, getOrderHash, getDomainSeparator };
