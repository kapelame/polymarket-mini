/**
 * MatchingEngine
 *
 * Runs continuously, checking each orderbook for crossable orders.
 *
 * Match conditions:
 *   bestBid.price >= bestAsk.price  → prices cross, fill at maker price
 *
 * Three settlement types:
 *   DIRECT  — BUY vs SELL for same token
 *   MINT    — two BUYs for complementary tokens (YES buyer + NO buyer)
 *   MERGE   — two SELLs for complementary tokens (YES seller + NO seller)
 */

const { EventEmitter } = require("events");

class MatchingEngine extends EventEmitter {
    constructor(books, settlement) {
        super();
        this.books      = books;      // Map<tokenId, OrderBook>
        this.settlement = settlement; // Settlement instance
        this.running    = false;
        this.interval   = null;

        // complementary token pairs: tokenId -> complementaryTokenId
        this.pairs = new Map();
    }

    registerPair(yesTokenId, noTokenId) {
        this.pairs.set(yesTokenId, noTokenId);
        this.pairs.set(noTokenId, yesTokenId);
        console.log(`Registered pair: YES=${yesTokenId.slice(0,10)}... NO=${noTokenId.slice(0,10)}...`);
    }

    start(intervalMs = 500) {
        if (this.running) return;
        this.running  = true;
        this.interval = setInterval(() => this._tick(), intervalMs);
        console.log(`Matching engine started (interval: ${intervalMs}ms)`);
    }

    stop() {
        this.running = false;
        if (this.interval) clearInterval(this.interval);
        console.log("Matching engine stopped");
    }

    async _tick() {
        for (const [tokenId, book] of this.books) {
            book.purge();

            // 1. Try direct match (BUY vs SELL, same token)
            await this._matchDirect(book);

            // 2. Try mint match (YES BUY + NO BUY)
            const compId = this.pairs.get(tokenId);
            if (compId && this.books.has(compId)) {
                const compBook = this.books.get(compId);
                await this._matchMint(book, compBook);
            }
        }
    }

    async _matchDirect(book) {
        const bid = book.bestBid();
        const ask = book.bestAsk();

        if (!bid || !ask) return;
        if (bid.price < ask.price) return; // no cross

        // Fill amount: min of what each side can offer
        // BUY order:  remaining = USDC available
        // SELL order: remaining = tokens available
        // Convert to token units using maker's price
        const bidTokens  = bid.remaining * BigInt(1e6) / BigInt(Math.round(bid.price * 1e6));
        const askTokens  = ask.remaining;
        const fillTokens = bidTokens < askTokens ? bidTokens : askTokens;

        const makerFill = ask.remaining < fillTokens ? ask.remaining : fillTokens; // tokens
        const takerFill = makerFill * BigInt(Math.round(ask.price * 1e6)) / BigInt(1e6); // USDC

        console.log(`DIRECT match: ${ask.maker.slice(0,8)} SELL ${makerFill} @ ${ask.price.toFixed(4)} <-> ${bid.maker.slice(0,8)} BUY`);

        try {
            await this.settlement.matchDirect(ask, bid, makerFill, takerFill);

            // Update remaining
            ask.remaining -= makerFill;
            bid.remaining -= takerFill;

            if (ask.remaining === 0n) book.remove(ask.id);
            if (bid.remaining === 0n) book.remove(bid.id);

            this.emit("fill", { type: "DIRECT", maker: ask, taker: bid, makerFill, takerFill });
        } catch (err) {
            console.error("Direct match failed:", err.message);
            book.remove(ask.id);
            book.remove(bid.id);
        }
    }

    async _matchMint(bookA, bookB) {
        // bookA has YES BUYs, bookB has NO BUYs
        const yesBid = bookA.bestBid();
        const noBid  = bookB.bestBid();

        if (!yesBid || !noBid) return;

        // Prices must sum to ~1.0 (someone buying YES at 0.6 + NO at 0.4 = 1.0)
        if (yesBid.price + noBid.price < 0.99) return;

        const fillUsdc = yesBid.remaining < noBid.remaining
            ? yesBid.remaining
            : noBid.remaining;

        console.log(`MINT match: ${yesBid.maker.slice(0,8)} BUY YES @ ${yesBid.price.toFixed(4)} + ${noBid.maker.slice(0,8)} BUY NO @ ${noBid.price.toFixed(4)}`);

        try {
            await this.settlement.matchMint(yesBid, noBid, fillUsdc);

            yesBid.remaining -= fillUsdc;
            noBid.remaining  -= fillUsdc;

            if (yesBid.remaining === 0n) bookA.remove(yesBid.id);
            if (noBid.remaining  === 0n) bookB.remove(noBid.id);

            this.emit("fill", { type: "MINT", yesBid, noBid, fillUsdc });
        } catch (err) {
            console.error("Mint match failed:", err.message);
        }
    }
}

module.exports = { MatchingEngine };
