const { ethers }          = require("ethers");
const { getNonceManager } = require("./NonceManager");

const CTF_ABI = [
    "function prepareCondition(address oracle, bytes32 questionId, uint256 outcomeSlotCount)",
    "function getConditionId(address oracle, bytes32 questionId, uint256 outcomeSlotCount) view returns (bytes32)",
    "function getCollectionId(bytes32 parentCollectionId, bytes32 conditionId, uint256 indexSet) view returns (bytes32)",
    "function getPositionId(address collateralToken, bytes32 collectionId) view returns (uint256)",
];
const ORACLE_ABI = [
    "function prepareMarket(bytes32 questionId, bytes32 conditionId, uint256 expiration)",
    "function proposeAnswer(bytes32 questionId, uint8 answer, uint256 bondAmount)",
    "function settle(bytes32 questionId)",
];
const EXCHANGE_ABI = ["function registerToken(bytes32 conditionId, uint256 indexSet)"];
const USDC_ABI = [
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
];

class MarketFactory {
    constructor(rpcUrl, operatorKey, { ctfAddress, oracleAddress, exchangeAddress, usdcAddress }) {
        this.provider      = new ethers.JsonRpcProvider(rpcUrl);
        this.operator      = new ethers.Wallet(operatorKey, this.provider);
        this.ctf           = new ethers.Contract(ctfAddress,      CTF_ABI,      this.operator);
        this.oracle        = new ethers.Contract(oracleAddress,   ORACLE_ABI,   this.operator);
        this.exchange      = new ethers.Contract(exchangeAddress, EXCHANGE_ABI, this.operator);
        this.usdc          = new ethers.Contract(usdcAddress,     USDC_ABI,     this.operator);
        this.usdcAddress   = usdcAddress;
        this.oracleAddress = oracleAddress;
        this.markets       = new Map();
        this.nm            = getNonceManager(this.provider, this.operator.address);
        console.log("MarketFactory: ready");
    }

    async _send(contractMethod, ...args) {
        const nonce = await this.nm.next();
        const tx    = await contractMethod(...args, { nonce });
        await tx.wait();
        return tx;
    }

    async getBtcPrice() {
        try {
            const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT",
                { signal: AbortSignal.timeout(3000) });
            const { price } = await r.json();
            if (!isNaN(+price) && +price > 0) return +price;
        } catch {}
        try {
            const r = await fetch("https://api.coinbase.com/v2/prices/BTC-USD/spot",
                { signal: AbortSignal.timeout(3000) });
            const { data } = await r.json();
            if (!isNaN(+data?.amount)) return +data.amount;
        } catch {}
        console.warn("MarketFactory: price APIs unavailable, using fallback $95000");
        return 95000;
    }

    async createBtcMarket(durationSeconds = 300) {
        // Use chain time to avoid expiration errors after anvil time warps
        const block      = await this.provider.getBlock("latest");
        const now        = Number(block.timestamp) + 60; // buffer for tx delay
    const wallNow    = Math.floor(Date.now() / 1000);
        const expiration = now + durationSeconds;
        const btcPrice   = await this.getBtcPrice();

        const question   = `Will BTC be higher than $${btcPrice.toFixed(0)} in ${Math.floor(durationSeconds/60)} min? t=${now}`;
        const questionId = ethers.keccak256(ethers.toUtf8Bytes(question));

        console.log(`MarketFactory: creating "${question}"`);
        console.log(`  Entry: $${btcPrice.toFixed(2)}, expires: ${new Date(expiration * 1000).toISOString()}`);

        await this.nm.sync(); // fresh sync before batch of txs

        await this._send((...a) => this.ctf.prepareCondition(...a), this.oracleAddress, questionId, 2);
        const conditionId = await this.ctf.getConditionId(this.oracleAddress, questionId, 2);

        await this._send((...a) => this.oracle.prepareMarket(...a), questionId, conditionId, expiration);
        await this._send((...a) => this.exchange.registerToken(...a), conditionId, 1);
        await this._send((...a) => this.exchange.registerToken(...a), conditionId, 2);

        const yesCollId = await this.ctf.getCollectionId(ethers.ZeroHash, conditionId, 1);
        const noCollId  = await this.ctf.getCollectionId(ethers.ZeroHash, conditionId, 2);
        const yesToken  = (await this.ctf.getPositionId(this.usdcAddress, yesCollId)).toString();
        const noToken   = (await this.ctf.getPositionId(this.usdcAddress,  noCollId)).toString();

        const market = {
            questionId, conditionId, question,
            btcEntryPrice: btcPrice, expiration, wallExpiration: Math.floor(Date.now()/1000) + durationSeconds, durationSeconds,
            yesToken, noToken, status: "OPEN",
            createdAt: now,
        };
        this.markets.set(questionId, market);

        const msUntilExpiry = durationSeconds * 1000;
        console.log(`MarketFactory: auto-resolve in ${durationSeconds}s`);
        setTimeout(() => this._resolveMarket(questionId), msUntilExpiry + 2000);

        console.log(`MarketFactory: ✓ YES=${yesToken.slice(0,20)}...`);
        return market;
    }

    async _resolveMarket(questionId) {
        const market = this.markets.get(questionId);
        if (!market || market.status !== "OPEN") return;
        try {
            const btcNow = await this.getBtcPrice();
            const won    = btcNow > market.btcEntryPrice ? "YES" : "NO";
            console.log(`MarketFactory: resolving — Entry $${market.btcEntryPrice.toFixed(2)} → Now $${btcNow.toFixed(2)} → ${won}`);

            const BOND = ethers.parseUnits("100", 6);
            const allowance = await this.usdc.allowance(this.operator.address, this.oracle.target);
            if (allowance < BOND) {
                await this._send((...a) => this.usdc.approve(...a), this.oracle.target, ethers.MaxUint256);
            }

            await this._send((...a) => this.oracle.proposeAnswer(...a), questionId, won === "YES" ? 1 : 2, BOND);
            console.log(`MarketFactory: proposed ${won} ✓`);

            await this.provider.send("anvil_increaseTime", [3601]);
            await this.provider.send("anvil_mine", []);
            await this.nm.resync(); // critical: resync after anvil_mine

            await this._send((...a) => this.oracle.settle(...a), questionId);
            console.log(`MarketFactory: settled ✓ — ${won} holders can redeem`);

            market.status = "SETTLED";
            market.btcExitPrice = btcNow;
            market.result = won;
        } catch (e) {
            console.error("MarketFactory: resolution failed:", e.message);
            market.status = "ERROR";
        }
    }

    getMarkets() { return [...this.markets.values()]; }
    getMarket(q) { return this.markets.get(q) || null; }
}

module.exports = { MarketFactory };
