const { Router } = require("express");
const { Order }  = require("../orderbook/OrderBook");
const { verifyOrderSignature } = require("../signing/verify");
const { verifyL1Signature }    = require("../auth/l1");
const { verifyL2Headers }      = require("../auth/l2");
const { ApiKeyStore }          = require("../auth/store");
const OrderRepo   = require("../db/OrderRepository");
const TradeRepo   = require("../db/TradeRepository");
const ApiKeyRepo  = require("../db/ApiKeyRepository");

const CHAIN_ID      = parseInt(process.env.CHAIN_ID || "31337");
const EXCHANGE_ADDR = process.env.EXCHANGE_ADDRESS || "0x0000000000000000000000000000000000000000";
const SERVER_SECRET = process.env.SERVER_SECRET || "dev-secret-change-in-production";

const apiKeyStore = new ApiKeyStore();

function cleanQuestion(question = "") {
    return String(question).split(" t=")[0].split("t=")[0].trim();
}

function asNumber(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
}

function units(value) {
    return asNumber(value) / 1e6;
}

function sidePrice(order) {
    const makerAmount = asNumber(order.makerAmount || order.maker_amount);
    const takerAmount = asNumber(order.takerAmount || order.taker_amount);
    if (!makerAmount || !takerAmount) return asNumber(order.price);
    return order.side === "BUY" ? makerAmount / takerAmount : takerAmount / makerAmount;
}

function orderShares(order) {
    return order.side === "BUY"
        ? units(order.takerAmount || order.taker_amount)
        : units(order.makerAmount || order.maker_amount);
}

function marketLookups(req) {
    const factory = req.app.get("marketFactory");
    const markets = typeof factory?.getMarkets === "function" ? factory.getMarkets() : [];
    const byToken = new Map();
    for (const market of markets) {
        byToken.set(String(market.yesToken), { market, outcome: "YES" });
        byToken.set(String(market.noToken), { market, outcome: "NO" });
    }
    return { markets, byToken };
}

function currentOutcomePrice(books, market, outcome) {
    if (market?.status === "SETTLED" && market.result) return market.result === outcome ? 1 : 0;
    const tokenId = outcome === "YES" ? market?.yesToken : market?.noToken;
    const book = tokenId ? books.get(String(tokenId)) : null;
    const bid = book?.bestBid?.();
    const ask = book?.bestAsk?.();
    if (bid && ask) return (bid.price + ask.price) / 2;
    if (ask) return ask.price;
    if (bid) return bid.price;
    return 0.5;
}

function enrichOrder(order, byToken) {
    const tokenId = String(order.tokenId || order.token_id || "");
    const lookup = byToken.get(tokenId);
    return {
        orderId: order.orderId || order.order_id || order.id,
        marketId: lookup?.market?.questionId || null,
        question: lookup?.market ? cleanQuestion(lookup.market.question) : "Unknown market",
        outcome: lookup?.outcome || "YES",
        side: order.side,
        status: order.status || "OPEN",
        price: sidePrice(order),
        shares: orderShares(order),
        notional: sidePrice(order) * orderShares(order),
        filled: units(order.filled || 0),
        createdAt: order.createdAt || order.created_at,
        tokenId,
    };
}

// Restore API keys from DB into memory store on startup
const restoreApiKeys = () => {
    // ApiKeyStore.keys is the in-memory map used for L2 verification
    // We patch it to also check DB on miss
    const original = apiKeyStore.keys;
    // keys is a plain object {apiKey -> {address, secret, passphrase}}
    // We'll load all from DB lazily via the verifyL2Headers path
};

module.exports = function createRoutes(books) {
    const router = Router();

    // ── Auth ────────────────────────────────────────────────────────────

    router.post("/auth/api-key", (req, res) => {
        try {
            const address   = req.headers["poly_address"];
            const timestamp = req.headers["poly_timestamp"];
            const nonce     = parseInt(req.headers["poly_nonce"] || "0");
            const signature = req.headers["poly_signature"];
            if (!address || !timestamp || !signature)
                return res.status(400).json({ error: "Missing headers" });

            verifyL1Signature(address, timestamp, nonce, signature, CHAIN_ID);

            // Check DB first (idempotent — same nonce always returns same creds)
            const existing = ApiKeyRepo.getByAddress(address);
            if (existing) {
                // Restore into memory store for L2 verification
                apiKeyStore.keys.set(existing.api_key, {
                    address:    existing.address,
                    secret:     existing.secret,
                    passphrase: existing.passphrase,
                });
                console.log(`API key restored for ${address.slice(0,10)}`);
                return res.json({
                    apiKey:     existing.api_key,
                    secret:     existing.secret,
                    passphrase: existing.passphrase,
                });
            }

            // Issue new key
            const creds = apiKeyStore.derive(address, nonce, SERVER_SECRET);

            // Persist to DB
            ApiKeyRepo.save({
                address,
                apiKey:     creds.apiKey,
                secret:     creds.secret,
                passphrase: creds.passphrase,
            });

            console.log(`API key issued for ${address.slice(0,10)}`);
            res.json(creds);
        } catch (err) {
            res.status(401).json({ error: err.message });
        }
    });

    function requireL2(req, res, next) {
        try {
            // Try memory first, then DB
            let trader;
            try {
                trader = verifyL2Headers(req, apiKeyStore.keys);
            } catch {
                // Restore from DB and retry
                const apiKey = req.headers["poly_api_key"];
                const stored = apiKey ? ApiKeyRepo.getByKey(apiKey) : null;
                if (stored) {
                    apiKeyStore.keys.set(stored.api_key, {
                        address:    stored.address,
                        secret:     stored.secret,
                        passphrase: stored.passphrase,
                    });
                    trader = verifyL2Headers(req, apiKeyStore.keys);
                } else {
                    throw new Error("Unauthorized");
                }
            }
            req.trader = trader;
            next();
        } catch (err) {
            res.status(401).json({ error: err.message });
        }
    }

    // ── Orders ──────────────────────────────────────────────────────────

    router.post("/order", requireL2, (req, res) => {
        try {
            const order = new Order(req.body);
            if (order.maker.toLowerCase() !== req.trader.address.toLowerCase())
                return res.status(403).json({ error: "Order maker must match authenticated address" });
            if (!books.has(order.tokenId.toString()))
                return res.status(400).json({ error: "Unknown market" });

            verifyOrderSignature(req.body, CHAIN_ID, EXCHANGE_ADDR);
            books.get(order.tokenId.toString()).add(order);

            // Persist
            OrderRepo.save({
                orderId:     order.id,
                maker:       order.maker,
                tokenId:     order.tokenId.toString(),
                side:        order.side,
                makerAmount: order.makerAmount.toString(),
                takerAmount: order.takerAmount.toString(),
                salt:        order.salt.toString(),
                signature:   req.body.signature,
                ...req.body,
            });

            console.log(`Order accepted: ${order.side} ${order.makerAmount} @ ${order.price.toFixed(4)} from ${order.maker.slice(0,8)}`);
            res.json({ orderId: order.id, status: "OPEN" });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    router.delete("/order/:id", requireL2, (req, res) => {
        for (const book of books.values()) book.remove(req.params.id);
        OrderRepo.updateStatus(req.params.id, "CANCELLED");
        res.json({ orderId: req.params.id, status: "CANCELLED" });
    });

    // ── Queries ─────────────────────────────────────────────────────────

    router.get("/orderbook/:tokenId", (req, res) => {
        const book = books.get(req.params.tokenId);
        if (!book) return res.status(404).json({ error: "Market not found" });
        res.json(book.snapshot());
    });

    router.get("/orders/:maker", requireL2, (req, res) => {
        if (req.params.maker.toLowerCase() !== req.trader.address.toLowerCase())
            return res.status(403).json({ error: "Forbidden" });
        res.json(OrderRepo.getByMaker(req.params.maker));
    });

    router.get("/account/:maker", requireL2, (req, res) => {
        try {
            if (req.params.maker.toLowerCase() !== req.trader.address.toLowerCase())
                return res.status(403).json({ error: "Forbidden" });

            const { byToken } = marketLookups(req);
            const orders = OrderRepo.getHistoryByMaker(req.params.maker, 120).map(order => enrichOrder(order, byToken));
            const rawTrades = TradeRepo.getByMaker(req.params.maker, 120);
            const positions = new Map();
            let totalVolume = 0;
            let settledPnl = 0;

            const trades = rawTrades.map((trade) => {
                const makerRaw = JSON.parse(trade.maker_raw_order);
                const takerRaw = JSON.parse(trade.taker_raw_order);
                const userIsMaker = trade.maker_address.toLowerCase() === req.params.maker.toLowerCase();
                const userOrder = userIsMaker ? makerRaw : takerRaw;
                const tokenId = String(trade.token_id);
                const lookup = byToken.get(tokenId);
                const market = lookup?.market || null;
                const outcome = lookup?.outcome || "YES";
                const shares = units(trade.size);
                const price = asNumber(trade.price);
                const notional = shares * price;
                const signedShares = userOrder.side === "BUY" ? shares : -shares;
                const cashFlow = userOrder.side === "BUY" ? -notional : notional;
                const currentPrice = market ? currentOutcomePrice(books, market, outcome) : price;
                const winnerValue = market?.status === "SETTLED" ? currentPrice : null;
                const pnl = winnerValue === null
                    ? cashFlow + signedShares * currentPrice
                    : userOrder.side === "BUY"
                        ? (winnerValue - price) * shares
                        : (price - winnerValue) * shares;

                totalVolume += notional;
                if (market?.status === "SETTLED") settledPnl += pnl;

                const key = `${market?.questionId || tokenId}:${outcome}`;
                const prev = positions.get(key) || {
                    marketId: market?.questionId || null,
                    question: market ? cleanQuestion(market.question) : "Unknown market",
                    outcome,
                    status: market?.status || "OPEN",
                    result: market?.result || null,
                    tokenId,
                    shares: 0,
                    cashFlow: 0,
                    buyShares: 0,
                    buyCost: 0,
                    currentPrice,
                    createdAt: market?.createdAt || trade.created_at,
                };
                prev.shares += signedShares;
                prev.cashFlow += cashFlow;
                if (userOrder.side === "BUY") {
                    prev.buyShares += shares;
                    prev.buyCost += notional;
                }
                prev.currentPrice = currentPrice;
                positions.set(key, prev);

                return {
                    tradeId: trade.trade_id,
                    orderId: userOrder.orderId || userOrder.order_id || (userIsMaker ? trade.maker_order : trade.taker_order),
                    marketId: market?.questionId || null,
                    question: market ? cleanQuestion(market.question) : "Unknown market",
                    outcome,
                    tokenId,
                    side: userOrder.side,
                    price,
                    shares,
                    notional,
                    pnl,
                    status: market?.status || "OPEN",
                    result: market?.result || null,
                    txHash: trade.tx_hash,
                    createdAt: trade.created_at,
                };
            });

            const positionRows = [...positions.values()]
                .filter(position => Math.abs(position.shares) > 0.000001 || Math.abs(position.cashFlow) > 0.000001)
                .map((position) => {
                    const value = position.shares * position.currentPrice;
                    const pnl = position.cashFlow + value;
                    return {
                        marketId: position.marketId,
                        question: position.question,
                        outcome: position.outcome,
                        status: position.status,
                        result: position.result,
                        tokenId: position.tokenId,
                        shares: position.shares,
                        avgPrice: position.buyShares > 0 ? position.buyCost / position.buyShares : 0,
                        currentPrice: position.currentPrice,
                        cost: position.buyCost,
                        value,
                        pnl,
                        createdAt: position.createdAt,
                    };
                })
                .sort((a, b) => {
                    const known = Number(Boolean(b.marketId)) - Number(Boolean(a.marketId));
                    if (known !== 0) return known;
                    const recent = (b.createdAt || 0) - (a.createdAt || 0);
                    if (recent !== 0) return recent;
                    return Math.abs(b.value) - Math.abs(a.value);
                });

            const openPnl = positionRows
                .filter(position => position.status !== "SETTLED")
                .reduce((sum, position) => sum + position.pnl, 0);
            const totalPnl = positionRows.reduce((sum, position) => sum + position.pnl, 0);

            res.json({
                address: req.params.maker,
                summary: {
                    totalPnl,
                    openPnl,
                    settledPnl,
                    totalVolume,
                    positionValue: positionRows.reduce((sum, position) => sum + position.value, 0),
                    tradeCount: trades.length,
                    openOrderCount: orders.filter(order => order.status === "OPEN" || order.status === "PARTIAL").length,
                    filledOrderCount: orders.filter(order => order.status === "FILLED").length,
                    marketsTraded: new Set(trades.map(trade => trade.marketId || trade.tokenId)).size,
                },
                positions: positionRows,
                trades,
                orders,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get("/trades/:tokenId", (req, res) => {
        const limit = parseInt(req.query.limit || "50");
        res.json(TradeRepo.getRecent(req.params.tokenId, limit));
    });

    router.get("/trades", (req, res) => {
        res.json(TradeRepo.getAll(100));
    });

    router.get("/markets", (req, res) => {
        res.json([...books.values()].map(b => b.snapshot()));
    });

    router.get("/health", (req, res) => {
        res.json({ status: "ok", markets: books.size });
    });

    return router;
};
