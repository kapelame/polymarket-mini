const { ethers } = require("ethers");

const ORACLE_ABI = [
    "function proposeAnswer(bytes32 questionId, uint8 answer, uint256 bondAmount)",
    "function disputeAnswer(bytes32 questionId, uint256 bondAmount)",
    "function settle(bytes32 questionId)",
    "function getMarket(bytes32 questionId) view returns (tuple(bytes32 conditionId,address creator,uint256 expiration,uint8 stage,uint8 proposedAnswer,address proposer,uint256 proposerBond,uint256 proposedAt,address disputer,uint256 disputerBond,bool resolved))",
    "function timeUntilExpiry(bytes32 questionId) view returns (int256)",
    "function timeUntilDisputeClose(bytes32 questionId) view returns (int256)",
    "function DISPUTE_WINDOW() view returns (uint256)",
];

const USDC_ABI = [
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
    "function balanceOf(address) view returns (uint256)",
];

const Outcome = { YES: 1, NO: 2 };
const Stage   = { PENDING: 0, PROPOSED: 1, DISPUTED: 2, SETTLED: 3 };

class OracleManager {
    constructor(rpcUrl, operatorKey, oracleAddress, usdcAddress) {
        this.provider      = new ethers.JsonRpcProvider(rpcUrl);
        this.operator      = new ethers.Wallet(operatorKey, this.provider);
        this.oracle        = new ethers.Contract(oracleAddress, ORACLE_ABI, this.operator);
        this.usdc          = new ethers.Contract(usdcAddress,   USDC_ABI,   this.operator);
        this.oracleAddress = oracleAddress;
        this.markets       = new Map();
        this._timer        = null;

        console.log("OracleManager: operator", this.operator.address);
    }

    registerMarket(questionId, expiration) {
        this.markets.set(questionId, { questionId, expiration });
        console.log(`Oracle: registered market ${questionId.slice(0,10)}... expires ${new Date(expiration * 1000).toISOString()}`);
    }

    start(intervalMs = 30_000) {
        this._timer = setInterval(() => this._tick(), intervalMs);
        console.log(`Oracle: monitoring ${this.markets.size} market(s) every ${intervalMs/1000}s`);
    }

    stop() {
        if (this._timer) clearInterval(this._timer);
    }

    async _tick() {
        for (const [questionId] of this.markets) {
            try {
                await this._checkMarket(questionId);
            } catch (e) {
                console.error(`Oracle tick error [${questionId.slice(0,10)}]:`, e.message);
            }
        }
    }

    async _checkMarket(questionId) {
        const market = await this.oracle.getMarket(questionId);
        const stage  = Number(market.stage);
        const now    = Math.floor(Date.now() / 1000);

        if (stage === Stage.SETTLED) return;

        if (stage === Stage.PENDING) {
            const expiry = Number(market.expiration);
            const mins = Math.floor((expiry - now) / 60);
            if (now < expiry) {
                console.log(`Oracle: market expires in ${mins} min`);
            } else {
                console.log(`Oracle: market expired, waiting for MarketFactory to propose...`);
            }
            return;
        }

        if (stage === Stage.PROPOSED) {
            const disputeClose = Number(market.proposedAt) + 3600;
            if (now >= disputeClose) {
                console.log(`Oracle: dispute window closed, settling...`);
                await this._settle(questionId);
            } else {
                const mins = Math.floor((disputeClose - now) / 60);
                console.log(`Oracle: dispute window closes in ${mins} min`);
            }
            return;
        }

        if (stage === Stage.DISPUTED) {
            console.log(`Oracle: market disputed, waiting for arbitrator`);
        }
    }

    async _proposeAnswer(questionId) {
        const BOND = ethers.parseUnits("100", 6);

        const allowance = await this.usdc.allowance(this.operator.address, this.oracleAddress);
        if (allowance < BOND) {
            console.log("Oracle: approving USDC for bond...");
            const tx = await this.usdc.approve(this.oracleAddress, ethers.MaxUint256);
            await tx.wait();
        }

        const answer = Outcome.YES;
        console.log(`Oracle: proposing answer YES with 100 USDC bond`);
        const tx = await this.oracle.proposeAnswer(questionId, answer, BOND);
        await tx.wait();
        console.log(`Oracle: answer proposed ✓ tx: ${tx.hash}`);
    }

    async _settle(questionId) {
        console.log("Oracle: calling settle()...");
        const tx = await this.oracle.settle(questionId);
        await tx.wait();
        console.log(`Oracle: market settled ✓ tx: ${tx.hash}`);
        console.log("Oracle: YES holders can now redeem USDC via CTF.redeemPositions()");
    }

    // Test only — skips dispute window via anvil time warp
    async forceExpireAndSettle(questionId) {
        console.log("Oracle: force settling (test mode)...");

        const market = await this.oracle.getMarket(questionId);
        const stage  = Number(market.stage);

        // Step 1: propose if still pending
        if (stage === Stage.PENDING) {
            await this._proposeAnswer(questionId);
        } else if (stage === Stage.SETTLED) {
            console.log("Oracle: already settled");
            return;
        }

        // Step 2: warp anvil time past dispute window
        console.log("Oracle: warping time past dispute window (3601s)...");
        await this.provider.send("anvil_increaseTime", [3601]);
        await this.provider.send("anvil_mine", []);

        // Step 3: settle
        await this._settle(questionId);
    }
}

module.exports = { OracleManager };
