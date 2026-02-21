const { ethers } = require("ethers");

const DOMAIN = { name: "ClobAuthDomain", version: "1" };
const TYPES  = {
    ClobAuth: [
        { name: "address",   type: "address" },
        { name: "timestamp", type: "string"  },
        { name: "nonce",     type: "uint256" },
        { name: "message",   type: "string"  },
    ],
};
const MSG_TO_SIGN = "This message attests that I control the given wallet";

function buildL1Message(address, timestamp, nonce) {
    return { address, timestamp: String(timestamp), nonce, message: MSG_TO_SIGN };
}

function verifyL1Signature(address, timestamp, nonce, signature, chainId) {
    const domain    = { ...DOMAIN, chainId };
    const message   = buildL1Message(address, timestamp, nonce);
    const recovered = ethers.verifyTypedData(domain, TYPES, message, signature);
    if (recovered.toLowerCase() !== address.toLowerCase()) {
        throw new Error(`L1 signature invalid: expected ${address}, got ${recovered}`);
    }
    const age = Date.now() / 1000 - parseInt(timestamp);
    if (age > 300) throw new Error("L1 signature expired");
    if (age < -10) throw new Error("L1 timestamp in the future");
    return true;
}

module.exports = { verifyL1Signature, buildL1Message, DOMAIN, TYPES, MSG_TO_SIGN };
