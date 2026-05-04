require("dotenv").config();
const http       = require("http");
const express    = require("express");
const cors       = require("cors");
const { OrderBook }      = require("./orderbook/OrderBook");
const { MatchingEngine } = require("./matching/MatchingEngine");
const { Settlement }     = require("./chain/Settlement");
const { OracleManager }  = require("./chain/Oracle");
const { WSServer }       = require("./api/websocket");
const createRoutes       = require("./api/routes");
const marketSubmitRoutes = require("./api/marketRoutes");
const { seedDemoLiquidity } = require("./demo/seedLiquidity");

const PORT          = process.env.PORT         || 3000;
const RPC_URL       = process.env.RPC_URL       || "http://localhost:8545";
const OPERATOR_KEY  = process.env.OPERATOR_KEY  || "dry-run";
const EXCHANGE_ADDR = process.env.EXCHANGE_ADDRESS || "0x0000000000000000000000000000000000000000";
const ORACLE_ADDR   = process.env.ORACLE_ADDRESS   || null;
const USDC_ADDR     = process.env.USDC_ADDRESS     || "0x5FbDB2315678afecb367f032d93F642f64180aa3";
const QUESTION_ID   = process.env.QUESTION_ID      || null;
const EXPIRATION    = process.env.EXPIRATION        || null;

const books      = new Map();
const settlement = new Settlement(RPC_URL, OPERATOR_KEY, EXCHANGE_ADDR);
const engine     = new MatchingEngine(books, settlement);

// Register markets from env
const pairs = (process.env.MARKET_PAIRS || "").split(",").filter(Boolean);
for (const pair of pairs) {
    const [yesId, noId] = pair.split(":");
    if (!yesId || !noId) continue;
    books.set(yesId, new OrderBook(yesId));
    books.set(noId,  new OrderBook(noId));
    engine.registerPair(yesId, noId);
}

if (books.size === 0) {
    const YES_ID = process.env.YES_TOKEN || "11111";
    const NO_ID  = process.env.NO_TOKEN  || "22222";
    books.set(YES_ID, new OrderBook(YES_ID));
    books.set(NO_ID,  new OrderBook(NO_ID));
    engine.registerPair(YES_ID, NO_ID);
    console.log(`Registered pair: YES=${YES_ID.slice(0,10)}... NO=${NO_ID.slice(0,10)}...`);
}

// Oracle manager
let oracle = null;
if (ORACLE_ADDR && OPERATOR_KEY !== "dry-run" && QUESTION_ID) {
    oracle = new OracleManager(RPC_URL, OPERATOR_KEY, ORACLE_ADDR, USDC_ADDR);
    oracle.registerMarket(QUESTION_ID, parseInt(EXPIRATION));
    oracle.start(30_000); // check every 30s
} else {
    console.log("Oracle: disabled (set ORACLE_ADDRESS + QUESTION_ID + EXPIRATION in .env)");
}

const app = express();
app.use(cors());
app.use(express.json());
app.use("/market/proposal", (req, res, next) => { req.app.set("marketFactory", factory); req.app.set("engine", engine); req.app.set("books", books); next(); }, marketSubmitRoutes);
app.use(express.json());

// Oracle status endpoint
app.get("/oracle/:questionId", async (req, res) => {
    if (!oracle) return res.json({ error: "oracle not configured" });
    try {
        const market = await oracle.oracle.getMarket(req.params.questionId);
        const stages = ["PENDING", "PROPOSED", "DISPUTED", "SETTLED"];
        const outcomes = ["UNRESOLVED", "YES", "NO"];
        res.json({
            stage:          stages[Number(market.stage)],
            proposedAnswer: outcomes[Number(market.proposedAnswer)],
            proposer:       market.proposer,
            expiration:     new Date(Number(market.expiration) * 1000).toISOString(),
            proposedAt:     market.proposedAt > 0n
                              ? new Date(Number(market.proposedAt) * 1000).toISOString()
                              : null,
            resolved:       market.resolved,
        });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

// Force settle endpoint (test only)
app.post("/oracle/:questionId/force-settle", async (req, res) => {
    if (!oracle) return res.json({ error: "oracle not configured" });
    try {
        await oracle.forceExpireAndSettle(req.params.questionId);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.use("/", createRoutes(books));

const server = http.createServer(app);
new WSServer(server, books, engine);

server.listen(PORT, () => {
    console.log(`CLOB server on port ${PORT}`);
    engine.start(500);
});

// ── Dynamic market creation (appended) ─────────────────────────────
const { MarketFactory } = require("./chain/MarketFactory");

const factory = new MarketFactory(RPC_URL, OPERATOR_KEY, {
    ctfAddress:      process.env.CTF_ADDRESS      || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    oracleAddress:   ORACLE_ADDR || "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    exchangeAddress: EXCHANGE_ADDR,
    usdcAddress:     USDC_ADDR,
});
app.set("marketFactory", factory);
app.set("engine", engine);
app.set("books", books);

app.post("/market/create/btc", async (req, res) => {
    try {
        const duration = parseInt(req.body.duration || "300"); // seconds
        if (duration < 60 || duration > 3600)
            return res.status(400).json({ error: "duration must be 60-3600 seconds" });

        const market = await factory.createBtcMarket(duration);

        // Add to live orderbooks
        books.set(market.yesToken, new (require("./orderbook/OrderBook").OrderBook)(market.yesToken));
        books.set(market.noToken,  new (require("./orderbook/OrderBook").OrderBook)(market.noToken));
        engine.registerPair(market.yesToken, market.noToken);

        if (req.body.seed !== false) {
            try {
                market.demoOrderIds = await seedDemoLiquidity(market, books, {
                    rpcUrl: RPC_URL,
                    chainId: parseInt(process.env.CHAIN_ID || "31337"),
                    usdcAddress: USDC_ADDR,
                    ctfAddress: process.env.CTF_ADDRESS || "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
                    exchangeAddress: EXCHANGE_ADDR,
                });
                console.log(`Demo liquidity seeded: ${market.demoOrderIds.length} orders`);
            } catch (seedErr) {
                market.demoSeedError = seedErr.message;
                console.error("Demo liquidity seeding failed:", seedErr.message);
            }
        }

        console.log(`New market added to engine: ${market.question.slice(0,50)}...`);
        res.json(market);
    } catch (e) {
        console.error("Market creation failed:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.post("/market/create/custom", async (req, res) => {
    try {
        const duration = parseInt(req.body.duration || "86400");
        if (duration < 60 || duration > 31536000)
            return res.status(400).json({ error: "duration must be 60-31536000 seconds" });

        const market = await factory.createCustomMarket(req.body.question, duration, {
            category: req.body.category || "news",
            description: req.body.description || "",
        });

        books.set(market.yesToken, new (require("./orderbook/OrderBook").OrderBook)(market.yesToken));
        books.set(market.noToken,  new (require("./orderbook/OrderBook").OrderBook)(market.noToken));
        engine.registerPair(market.yesToken, market.noToken);

        console.log(`New custom market added to engine: ${market.question.slice(0,50)}...`);
        res.json(market);
    } catch (e) {
        console.error("Custom market creation failed:", e.message);
        res.status(500).json({ error: e.message });
    }
});

app.delete('/market/:questionId', (req, res) => {
    const market = factory.deleteMarket(req.params.questionId);
    if (market) {
        books.delete(market.yesToken);
        books.delete(market.noToken);
    }
    res.json({ ok: !!market });
});

app.get("/market/list", (req, res) => {
    res.json(factory.getMarkets());
});

app.get("/market/:questionId", (req, res) => {
    const m = factory.getMarket(req.params.questionId);
    if (!m) return res.status(404).json({ error: "Market not found" });
    res.json(m);
});
