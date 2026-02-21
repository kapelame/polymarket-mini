const { WebSocketServer } = require("ws");

/**
 * WebSocket server — real-time orderbook updates.
 *
 * Polymarket uses channels:
 *   market   — orderbook snapshots on every change
 *   user     — private fills for a specific address
 *
 * Client subscribes by sending:
 *   { type: "subscribe", channel: "market", tokenId: "11111" }
 *   { type: "subscribe", channel: "user",   address: "0x..." }
 */

class WSServer {
    constructor(server, books, engine) {
        this.wss   = new WebSocketServer({ server });
        this.books = books;

        // Map<tokenId, Set<ws>>  — market subscribers
        this.marketSubs = new Map();
        // Map<address, Set<ws>>  — user subscribers
        this.userSubs   = new Map();

        this.wss.on("connection", (ws) => this._onConnect(ws));

        // Broadcast on every fill
        engine.on("fill", (fill) => this._onFill(fill));

        console.log("WebSocket server ready");
    }

    _onConnect(ws) {
        console.log("WS client connected");

        ws.on("message", (data) => {
            try {
                const msg = JSON.parse(data.toString());
                this._handleMessage(ws, msg);
            } catch (err) {
                ws.send(JSON.stringify({ type: "error", message: err.message }));
            }
        });

        ws.on("close", () => this._cleanup(ws));

        // Send welcome
        ws.send(JSON.stringify({ type: "connected", message: "Polymarket Mini CLOB" }));
    }

    _handleMessage(ws, msg) {
        if (msg.type === "subscribe") {
            if (msg.channel === "market" && msg.tokenId) {
                if (!this.marketSubs.has(msg.tokenId)) {
                    this.marketSubs.set(msg.tokenId, new Set());
                }
                this.marketSubs.get(msg.tokenId).add(ws);
                ws._marketSubs = ws._marketSubs || new Set();
                ws._marketSubs.add(msg.tokenId);

                // Send current snapshot immediately
                const book = this.books.get(msg.tokenId);
                if (book) {
                    ws.send(JSON.stringify({
                        type:    "orderbook_snapshot",
                        tokenId: msg.tokenId,
                        data:    book.snapshot(),
                    }));
                }
                console.log(`WS subscribed to market ${msg.tokenId}`);
            }

            if (msg.channel === "user" && msg.address) {
                const addr = msg.address.toLowerCase();
                if (!this.userSubs.has(addr)) {
                    this.userSubs.set(addr, new Set());
                }
                this.userSubs.get(addr).add(ws);
                ws._userAddr = addr;
                console.log(`WS subscribed to user ${addr.slice(0,10)}`);
            }
        }

        if (msg.type === "unsubscribe") {
            this._cleanup(ws);
        }
    }

    _onFill(fill) {
        if (fill.type === "DIRECT") {
            const { maker, taker, makerFill, takerFill } = fill;
            const tokenId = maker.tokenId.toString();

            // Push updated orderbook to market subscribers
            this._pushOrderbook(tokenId);

            // Push fill event to user subscribers
            const fillMsg = {
                type:       "fill",
                tokenId,
                makerFill:  makerFill.toString(),
                takerFill:  takerFill.toString(),
                price:      maker.price.toFixed(4),
                timestamp:  Date.now(),
            };

            this._pushToUser(maker.maker, { ...fillMsg, side: maker.side, role: "maker" });
            this._pushToUser(taker.maker, { ...fillMsg, side: taker.side, role: "taker" });
        }

        if (fill.type === "MINT") {
            const { yesBid, noBid, fillUsdc } = fill;
            this._pushOrderbook(yesBid.tokenId.toString());
            this._pushOrderbook(noBid.tokenId.toString());
            this._pushToUser(yesBid.maker, { type: "fill", role: "maker", side: "BUY", fillUsdc: fillUsdc.toString() });
            this._pushToUser(noBid.maker,  { type: "fill", role: "maker", side: "BUY", fillUsdc: fillUsdc.toString() });
        }
    }

    _pushOrderbook(tokenId) {
        const subs = this.marketSubs.get(tokenId);
        if (!subs || subs.size === 0) return;
        const book = this.books.get(tokenId);
        if (!book) return;
        const msg = JSON.stringify({
            type:    "orderbook_update",
            tokenId,
            data:    book.snapshot(),
        });
        for (const ws of subs) {
            if (ws.readyState === 1) ws.send(msg);
        }
    }

    _pushToUser(address, payload) {
        const subs = this.userSubs.get(address.toLowerCase());
        if (!subs) return;
        const msg = JSON.stringify(payload);
        for (const ws of subs) {
            if (ws.readyState === 1) ws.send(msg);
        }
    }

    _cleanup(ws) {
        if (ws._marketSubs) {
            for (const tokenId of ws._marketSubs) {
                this.marketSubs.get(tokenId)?.delete(ws);
            }
        }
        if (ws._userAddr) {
            this.userSubs.get(ws._userAddr)?.delete(ws);
        }
    }
}

module.exports = { WSServer };
