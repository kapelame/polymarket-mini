const { Router } = require("express");
const { Order }  = require("../orderbook/OrderBook");
const { verifyOrderSignature } = require("../signing/verify");
const { verifyL1Signature }    = require("../auth/l1");
const { verifyL2Headers }      = require("../auth/l2");
const { ApiKeyStore }          = require("../auth/store");

const CHAIN_ID      = parseInt(process.env.CHAIN_ID || "31337");
const EXCHANGE_ADDR = process.env.EXCHANGE_ADDRESS || "0x0000000000000000000000000000000000000000";
const SERVER_SECRET = process.env.SERVER_SECRET || "dev-secret-change-in-production";

const apiKeyStore = new ApiKeyStore();

module.exports = function createRoutes(books) {
    const router = Router();

    router.post("/auth/api-key", (req, res) => {
        try {
            const address   = req.headers["poly_address"];
            const timestamp = req.headers["poly_timestamp"];
            const nonce     = parseInt(req.headers["poly_nonce"] || "0");
            const signature = req.headers["poly_signature"];
            if (!address || !timestamp || !signature) {
                return res.status(400).json({ error: "Missing headers" });
            }
            verifyL1Signature(address, timestamp, nonce, signature, CHAIN_ID);
            const creds = apiKeyStore.derive(address, nonce, SERVER_SECRET);
            console.log(`API key issued for ${address.slice(0,10)}`);
            res.json(creds);
        } catch (err) {
            res.status(401).json({ error: err.message });
        }
    });

    function requireL2(req, res, next) {
        try {
            req.trader = verifyL2Headers(req, apiKeyStore.keys);
            next();
        } catch (err) {
            res.status(401).json({ error: err.message });
        }
    }

    router.post("/order", requireL2, (req, res) => {
        try {
            const order = new Order(req.body);
            if (order.maker.toLowerCase() !== req.trader.address.toLowerCase()) {
                return res.status(403).json({ error: "Order maker must match authenticated address" });
            }
            if (!books.has(order.tokenId.toString())) {
                return res.status(400).json({ error: "Unknown market" });
            }
            verifyOrderSignature(req.body, CHAIN_ID, EXCHANGE_ADDR);
            books.get(order.tokenId.toString()).add(order);
            console.log(`Order accepted: ${order.side} ${order.makerAmount} @ ${order.price.toFixed(4)} from ${order.maker.slice(0,8)}`);
            res.json({ orderId: order.id, status: "OPEN" });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    router.delete("/order/:id", requireL2, (req, res) => {
        for (const book of books.values()) book.remove(req.params.id);
        res.json({ orderId: req.params.id, status: "CANCELLED" });
    });

    router.get("/orderbook/:tokenId", (req, res) => {
        const book = books.get(req.params.tokenId);
        if (!book) return res.status(404).json({ error: "Market not found" });
        res.json(book.snapshot());
    });

    router.get("/markets", (req, res) => {
        res.json([...books.values()].map(b => b.snapshot()));
    });

    router.get("/health", (req, res) => {
        res.json({ status: "ok", markets: books.size });
    });

    return router;
};
