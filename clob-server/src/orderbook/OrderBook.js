/**
 * OrderBook
 *
 * Maintains two sides per market (tokenId):
 *   bids: BUY orders, sorted by price descending  (highest price first)
 *   asks: SELL orders, sorted by price ascending   (lowest price first)
 *
 * Price = makerAmount / takerAmount
 *   BUY  order: makerAmount = USDC, takerAmount = tokens  → price = USDC/token
 *   SELL order: makerAmount = tokens, takerAmount = USDC  → price = USDC/token
 */

class Order {
    constructor(raw) {
        this.salt          = raw.salt;
        this.maker         = raw.maker;
        this.signer        = raw.signer;
        this.taker         = raw.taker || "0x0000000000000000000000000000000000000000";
        this.tokenId       = raw.tokenId;
        this.makerAmount   = BigInt(raw.makerAmount);
        this.takerAmount   = BigInt(raw.takerAmount);
        this.expiration    = BigInt(raw.expiration || 0);
        this.nonce         = BigInt(raw.nonce || 0);
        this.feeRateBps    = BigInt(raw.feeRateBps || 0);
        this.side          = raw.side; // "BUY" or "SELL"
        this.signatureType = raw.signatureType || 0;
        this.signature     = raw.signature;

        // Derived
        this.price = this.side === "BUY"
            ? Number(this.makerAmount) / Number(this.takerAmount)  // USDC per token
            : Number(this.takerAmount) / Number(this.makerAmount); // USDC per token

        this.remaining = this.makerAmount; // tracks unfilled amount
        this.id        = `${this.maker}-${this.salt}`;
        this.timestamp = Date.now();
    }

    isExpired() {
        if (this.expiration === 0n) return false;
        return BigInt(Math.floor(Date.now() / 1000)) >= this.expiration;
    }

    toChainFormat() {
        return {
            salt:          this.salt.toString(),
            maker:         this.maker,
            signer:        this.signer,
            taker:         this.taker,
            tokenId:       this.tokenId.toString(),
            makerAmount:   this.makerAmount.toString(),
            takerAmount:   this.takerAmount.toString(),
            expiration:    this.expiration.toString(),
            nonce:         this.nonce.toString(),
            feeRateBps:    this.feeRateBps.toString(),
            side:          this.side === "BUY" ? 0 : 1,
            signatureType: this.signatureType,
            signature:     this.signature,
        };
    }
}

class OrderBook {
    constructor(tokenId) {
        this.tokenId = tokenId;
        this.bids    = []; // BUY  orders, price desc
        this.asks    = []; // SELL orders, price asc
    }

    add(order) {
        if (order.isExpired()) throw new Error("Order expired");

        if (order.side === "BUY") {
            this.bids.push(order);
            this.bids.sort((a, b) => b.price - a.price); // best bid first
        } else {
            this.asks.push(order);
            this.asks.sort((a, b) => a.price - b.price); // best ask first
        }

        return order;
    }

    remove(orderId) {
        this.bids = this.bids.filter(o => o.id !== orderId);
        this.asks = this.asks.filter(o => o.id !== orderId);
    }

    // Clean expired orders
    purge() {
        this.bids = this.bids.filter(o => !o.isExpired());
        this.asks = this.asks.filter(o => !o.isExpired());
    }

    bestBid() { return this.bids[0] || null; }
    bestAsk() { return this.asks[0] || null; }

    spread() {
        const bid = this.bestBid();
        const ask = this.bestAsk();
        if (!bid || !ask) return null;
        return ask.price - bid.price;
    }

    snapshot() {
        this.purge();
        return {
            tokenId: this.tokenId,
            bids: this.bids.slice(0, 10).map(o => ({
                price:     o.price.toFixed(4),
                size:      o.remaining.toString(),
                maker:     o.maker,
                id:        o.id,
            })),
            asks: this.asks.slice(0, 10).map(o => ({
                price:     o.price.toFixed(4),
                size:      o.remaining.toString(),
                maker:     o.maker,
                id:        o.id,
            })),
            spread: this.spread()?.toFixed(4) || null,
        };
    }
}

module.exports = { Order, OrderBook };
