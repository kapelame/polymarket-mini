const { ethers }   = require("ethers");
const TradeRepo    = require("../db/TradeRepository");
const OrderRepo    = require("../db/OrderRepository");

const EXCHANGE_ABI = [
    "function matchOrders(tuple(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) makerOrder, tuple(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) takerOrder, uint256 makerAssetFillAmount, uint256 takerAssetFillAmount)",
    "function matchComplementaryOrders(tuple(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) yesBidOrder, tuple(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) noBidOrder, uint256 usdcAmount)",
    "function matchComplementarySellOrders(tuple(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) yesSellOrder, tuple(uint256 salt,address maker,address signer,address taker,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint256 expiration,uint256 nonce,uint256 feeRateBps,uint8 side,uint8 signatureType,bytes signature) noSellOrder, uint256 tokenAmount)",
];

class Settlement {
    constructor(rpcUrl, privateKey, exchangeAddress) {
        this.dryRun = !privateKey || privateKey === "dry-run";
        if (!this.dryRun) {
            this.provider = new ethers.JsonRpcProvider(rpcUrl);
            this.wallet   = new ethers.Wallet(privateKey, this.provider);
            this.exchange = new ethers.Contract(exchangeAddress, EXCHANGE_ABI, this.wallet);
            console.log(`Settlement: LIVE mode, operator: ${this.wallet.address}`);
        } else {
            console.log("Settlement: DRY RUN mode");
        }
    }

    _fmt(order) {
        return {
            salt:          BigInt(order.salt),
            maker:         order.maker,
            signer:        order.signer || order.maker,
            taker:         order.taker  || "0x0000000000000000000000000000000000000000",
            tokenId:       BigInt(order.tokenId),
            makerAmount:   BigInt(order.makerAmount),
            takerAmount:   BigInt(order.takerAmount),
            expiration:    BigInt(order.expiration  || 0),
            nonce:         BigInt(order.nonce       || 0),
            feeRateBps:    BigInt(order.feeRateBps  || 0),
            side:          order.side === "BUY" ? 0 : 1,
            signatureType: order.signatureType || 0,
            signature:     order.signature,
        };
    }

    _price(makerOrder) {
        // SELL order: price = takerAmount / makerAmount
        // BUY  order: price = makerAmount / takerAmount
        if (makerOrder.side === "SELL") {
            return Number(makerOrder.takerAmount) / Number(makerOrder.makerAmount);
        }
        return Number(makerOrder.makerAmount) / Number(makerOrder.takerAmount);
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

        // Persist trade
        const size  = makerFill.toString();
        const price = this._price(makerOrder);
        TradeRepo.save({
            makerOrderId: makerOrder.id || makerOrder.orderId,
            takerOrderId: takerOrder.id || takerOrder.orderId,
            tokenId:      makerOrder.tokenId.toString(),
            price,
            size,
            txHash:       tx.hash,
        });

        // Update order statuses
        OrderRepo.updateStatus(makerOrder.id || makerOrder.orderId, "FILLED", size);
        OrderRepo.updateStatus(takerOrder.id || takerOrder.orderId, "FILLED", size);
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

        const size  = usdcAmount.toString();
        const price = this._price(yesBidOrder);
        TradeRepo.save({
            makerOrderId: yesBidOrder.id || yesBidOrder.orderId,
            takerOrderId: noBidOrder.id  || noBidOrder.orderId,
            tokenId:      yesBidOrder.tokenId.toString(),
            price,
            size,
            txHash:       tx.hash,
        });

        OrderRepo.updateStatus(yesBidOrder.id || yesBidOrder.orderId, "FILLED", size);
        OrderRepo.updateStatus(noBidOrder.id  || noBidOrder.orderId,  "FILLED", size);
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

        const size  = tokenAmount.toString();
        const price = this._price(yesSellOrder);
        TradeRepo.save({
            makerOrderId: yesSellOrder.id || yesSellOrder.orderId,
            takerOrderId: noSellOrder.id  || noSellOrder.orderId,
            tokenId:      yesSellOrder.tokenId.toString(),
            price,
            size,
            txHash:       tx.hash,
        });

        OrderRepo.updateStatus(yesSellOrder.id || yesSellOrder.orderId, "FILLED", size);
        OrderRepo.updateStatus(noSellOrder.id  || noSellOrder.orderId,  "FILLED", size);
    }
}

module.exports = { Settlement };
