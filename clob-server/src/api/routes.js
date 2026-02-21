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
                apiKeyStore.keys[existing.api_key] = {
                    address:    existing.address,
                    secret:     existing.secret,
                    passphrase: existing.passphrase,
                };
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
                    apiKeyStore.keys[stored.api_key] = {
                        address:    stored.address,
                        secret:     stored.secret,
                        passphrase: stored.passphrase,
                    };
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
