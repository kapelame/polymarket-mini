const { ethers } = require("ethers");

// Singleton nonce manager — serializes all txs from one wallet
class NonceManager {
    constructor(provider, address) {
        this.provider = provider;
        this.address  = address;
        this._nonce   = null;
        this._queue   = Promise.resolve();
    }

    async sync() {
        this._nonce = await this.provider.getTransactionCount(this.address, "latest");
    }

    // Get next nonce, syncing from chain if needed
    async next() {
        if (this._nonce === null) await this.sync();
        return this._nonce++;
    }

    // Call after anvil_mine to resync
    async resync() {
        this._nonce = null;
        await this.sync();
    }
}

// Global singleton keyed by address
const managers = new Map();

function getNonceManager(provider, address) {
    if (!managers.has(address)) {
        managers.set(address, new NonceManager(provider, address));
    }
    return managers.get(address);
}

module.exports = { getNonceManager };
