require("dotenv").config();
const http       = require("http");
const express    = require("express");
const { OrderBook }      = require("./orderbook/OrderBook");
const { MatchingEngine } = require("./matching/MatchingEngine");
const { Settlement }     = require("./chain/Settlement");
const { WSServer }       = require("./api/websocket");
const createRoutes       = require("./api/routes");

const PORT          = process.env.PORT || 3000;
const RPC_URL       = process.env.RPC_URL || "http://localhost:8545";
const OPERATOR_KEY  = process.env.OPERATOR_KEY || "dry-run";
const EXCHANGE_ADDR = process.env.EXCHANGE_ADDRESS || "0x0000000000000000000000000000000000000000";

const books      = new Map();
const settlement = new Settlement(RPC_URL, OPERATOR_KEY, EXCHANGE_ADDR);
const engine     = new MatchingEngine(books, settlement);

// Register markets
const pairs = (process.env.MARKET_PAIRS || "").split(",").filter(Boolean);
for (const pair of pairs) {
    const [yesId, noId] = pair.split(":");
    if (!yesId || !noId) continue;
    books.set(yesId, new OrderBook(yesId));
    books.set(noId,  new OrderBook(noId));
    engine.registerPair(yesId, noId);
}

if (books.size === 0) {
    const YES_ID = "11111";
    const NO_ID  = "22222";
    books.set(YES_ID, new OrderBook(YES_ID));
    books.set(NO_ID,  new OrderBook(NO_ID));
    engine.registerPair(YES_ID, NO_ID);
    console.log("Demo market: YES=11111, NO=22222");
}

const app    = express();
app.use(express.json());
app.use("/", createRoutes(books));

// Share HTTP server between Express and WebSocket
const server = http.createServer(app);
new WSServer(server, books, engine);

server.listen(PORT, () => {
    console.log(`CLOB server on port ${PORT}`);
    engine.start(500);
});
