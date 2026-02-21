const { ethers } = require("ethers");

const EXCHANGE_ABI = [
    "function matchOrders((uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) makerOrder,(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) takerOrder,uint256 makerFillAmount,uint256 takerFillAmount)",
    "function matchComplementaryOrders((uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) makerOrder,(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) takerOrder,uint256 usdcAmount)",
    "function matchComplementarySellOrders((uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) makerOrder,(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) takerOrder,uint256 tokenAmount)",
];

class Settlement {
    constructor(rpcUrl, privateKey, exchangeAddress) {
        this.dryRun = !privateKey || privateKey === "dry-run";
        if (this.dryRun) {
            console.log("Settlement: DRY RUN mode");
        } else {
            this.provider = new ethers.JsonRpcProvider(rpcUrl);
            this.wallet   = new ethers.Wallet(privateKey, this.provider);
            this.exchange = new ethers.Contract(exchangeAddress, EXCHANGE_ABI, this.wallet);
            console.log("Settlement: LIVE mode, operator:", this.wallet.address);
        }
    }

    _fmt(order) {
        return {
            salt:          order.salt.toString(),
            maker:         order.maker,
            signer:        order.signer,
            taker:         order.taker,
            tokenId:       order.tokenId.toString(),
            makerAmount:   order.makerAmount.toString(),
            takerAmount:   order.takerAmount.toString(),
            expiration:    order.expiration.toString(),
            nonce:         order.nonce.toString(),
            feeRateBps:    order.feeRateBps.toString(),
            side:          order.side === "BUY" ? 0 : 1,
            signatureType: order.signatureType || 0,
            signature:     order.signature,
        };
    }

    async matchDirect(makerOrder, takerOrder, makerFill, takerFill) {
        if (this.dryRun) {
            console.log("[DRY RUN] matchOrders", makerFill.toString(), takerFill.toString());
            return;
        }
        console.log("Submitting matchOrders on-chain...");
        const tx = await this.exchange.matchOrders(
            this._fmt(makerOrder),
            this._fmt(takerOrder),
            makerFill,
            takerFill
        );
        console.log("tx:", tx.hash);
        const rc = await tx.wait();
        console.log(`matchOrders confirmed (block ${rc.blockNumber}, gas ${rc.gasUsed})`);
    }

    async matchMint(yesBidOrder, noBidOrder, usdcAmount) {
        if (this.dryRun) {
            console.log("[DRY RUN] matchComplementaryOrders", usdcAmount.toString());
            return;
        }
        console.log("Submitting matchComplementaryOrders on-chain...");
        const tx = await this.exchange.matchComplementaryOrders(
            this._fmt(yesBidOrder),
            this._fmt(noBidOrder),
            usdcAmount
        );
        console.log("tx:", tx.hash);
        const rc = await tx.wait();
        console.log(`matchComplementaryOrders confirmed (block ${rc.blockNumber}, gas ${rc.gasUsed})`);
    }

    async matchMerge(yesSellOrder, noSellOrder, tokenAmount) {
        if (this.dryRun) {
            console.log("[DRY RUN] matchComplementarySellOrders", tokenAmount.toString());
            return;
        }
        console.log("Submitting matchComplementarySellOrders on-chain...");
        const tx = await this.exchange.matchComplementarySellOrders(
            this._fmt(yesSellOrder),
            this._fmt(noSellOrder),
            tokenAmount
        );
        console.log("tx:", tx.hash);
        const rc = await tx.wait();
        console.log(`matchComplementarySellOrders confirmed (block ${rc.blockNumber}, gas ${rc.gasUsed})`);
    }
}

module.exports = { Settlement };
