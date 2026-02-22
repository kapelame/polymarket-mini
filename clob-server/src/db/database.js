const Database = require("better-sqlite3");
const path     = require("path");

const DB_PATH = process.env.DB_PATH || path.join(__dirname, "../../data/clob.db");

// Ensure data directory exists
const fs = require("fs");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// Performance settings
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");
db.pragma("foreign_keys = ON");

// Schema
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    address     TEXT PRIMARY KEY,
    api_key     TEXT NOT NULL UNIQUE,
    secret      TEXT NOT NULL,
    passphrase  TEXT NOT NULL,
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE TABLE IF NOT EXISTS orders (
    order_id     TEXT PRIMARY KEY,
    maker        TEXT NOT NULL,
    token_id     TEXT NOT NULL,
    side         TEXT NOT NULL CHECK(side IN ('BUY','SELL')),
    price        REAL NOT NULL,
    maker_amount TEXT NOT NULL,
    taker_amount TEXT NOT NULL,
    filled       TEXT NOT NULL DEFAULT '0',
    status       TEXT NOT NULL DEFAULT 'OPEN'
                    CHECK(status IN ('OPEN','FILLED','CANCELLED','PARTIAL')),
    salt         TEXT NOT NULL,
    signature    TEXT NOT NULL,
    raw_order    TEXT NOT NULL,
    created_at   INTEGER DEFAULT (unixepoch()),
    updated_at   INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_orders_token  ON orders(token_id, status);
  CREATE INDEX IF NOT EXISTS idx_orders_maker  ON orders(maker);

  CREATE TABLE IF NOT EXISTS trades (
    trade_id    TEXT PRIMARY KEY,
    maker_order TEXT NOT NULL REFERENCES orders(order_id),
    taker_order TEXT NOT NULL REFERENCES orders(order_id),
    token_id    TEXT NOT NULL,
    price       REAL NOT NULL,
    size        TEXT NOT NULL,
    tx_hash     TEXT,
    created_at  INTEGER DEFAULT (unixepoch())
  );

  CREATE INDEX IF NOT EXISTS idx_trades_token ON trades(token_id);
  CREATE INDEX IF NOT EXISTS idx_trades_time  ON trades(created_at DESC);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS pending_markets (
    id            TEXT PRIMARY KEY,
    creator       TEXT NOT NULL,
    type          TEXT NOT NULL DEFAULT 'CUSTOM',
    question      TEXT NOT NULL,
    description   TEXT,
    category      TEXT NOT NULL DEFAULT 'crypto',
    duration      INTEGER NOT NULL DEFAULT 86400,
    status        TEXT NOT NULL DEFAULT 'PENDING',
    created_at    INTEGER DEFAULT (unixepoch()),
    reviewed_at   INTEGER,
    reviewer      TEXT,
    reject_reason TEXT
  );
`);

module.exports = db;
