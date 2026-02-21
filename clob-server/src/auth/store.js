const crypto = require("crypto");

class ApiKeyStore {
    constructor() {
        this.keys      = new Map();
        this.byAddress = new Map();
    }

    derive(address, nonce, serverSecret) {
        const seed       = crypto.createHmac("sha256", serverSecret)
            .update(`${address.toLowerCase()}:${nonce}`).digest();
        const apiKey     = seed.slice(0, 16).toString("hex");
        const secret     = seed.slice(16, 32).toString("base64");
        const passphrase = seed.slice(0, 8).toString("hex");
        const creds      = { address: address.toLowerCase(), secret, passphrase, nonce };
        this.keys.set(apiKey, creds);
        this.byAddress.set(address.toLowerCase(), apiKey);
        return { apiKey, secret, passphrase };
    }

    get(apiKey)        { return this.keys.get(apiKey); }
    getByAddress(addr) { return this.byAddress.get(addr.toLowerCase()); }
}

module.exports = { ApiKeyStore };
