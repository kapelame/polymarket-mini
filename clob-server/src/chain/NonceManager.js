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
        const [latest, pending] = await Promise.all([
            this.provider.getTransactionCount(this.address, "latest"),
            this.provider.getTransactionCount(this.address, "pending"),
        ]);
        this._nonce = Math.max(latest, pending);
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

    async send(sendTx, { retries = 2 } = {}) {
        const job = this._queue.then(async () => {
            let lastError = null;
            for (let attempt = 0; attempt <= retries; attempt += 1) {
                if (attempt > 0 || this._nonce === null) await this.sync();
                const nonce = await this.next();
                try {
                    const tx = await sendTx(nonce);
                    const receipt = await tx.wait();
                    return { tx, receipt };
                } catch (err) {
                    lastError = err;
                    const message = String(err?.message || "");
                    const code = String(err?.code || "");
                    const isNonceError = code === "NONCE_EXPIRED" || /nonce (too low|has already been used)/i.test(message);
                    if (!isNonceError || attempt === retries) throw err;
                    await this.resync();
                }
            }
            throw lastError;
        });
        this._queue = job.catch(() => {});
        return job;
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
