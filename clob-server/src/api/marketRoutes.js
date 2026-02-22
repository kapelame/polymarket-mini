const express = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../db/database");

const router = express.Router();

// Admin wallet — hardcoded for Anvil (account #1)
const ADMIN = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".toLowerCase();

function isAdmin(req) {
  const addr = (req.headers["x-address"] || "").toLowerCase();
  return addr === ADMIN;
}

// ── User: submit a market for approval ───────────────────────────────
router.post("/submit", (req, res) => {
  const { creator, type = "CUSTOM", question, description, category = "crypto", duration = 86400 } = req.body;
  if (!creator || !question) return res.status(400).json({ error: "creator and question required" });
  if (question.length < 10) return res.status(400).json({ error: "question too short" });

  const id = uuidv4();
  db.prepare(`
    INSERT INTO pending_markets (id, creator, type, question, description, category, duration)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, creator, type, question, description || "", category, duration);

  res.json({ id, status: "PENDING", message: "Market submitted for review" });
});

// ── User: get their own submissions ─────────────────────────────────
router.get("/my/:address", (req, res) => {
  const rows = db.prepare(
    "SELECT * FROM pending_markets WHERE creator = ? ORDER BY created_at DESC"
  ).all(req.params.address);
  res.json(rows);
});

// ── Admin: list pending markets ──────────────────────────────────────
router.get("/pending", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
  const rows = db.prepare(
    "SELECT * FROM pending_markets WHERE status = 'PENDING' ORDER BY created_at ASC"
  ).all();
  res.json(rows);
});

// ── Admin: list all submissions ──────────────────────────────────────
router.get("/all", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });
  const rows = db.prepare(
    "SELECT * FROM pending_markets ORDER BY created_at DESC LIMIT 100"
  ).all();
  res.json(rows);
});

// ── Admin: approve ───────────────────────────────────────────────────
router.post("/approve/:id", async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });

  const row = db.prepare("SELECT * FROM pending_markets WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "PENDING") return res.status(400).json({ error: `Already ${row.status}` });

  // Update status first
  db.prepare(`
    UPDATE pending_markets SET status = 'APPROVED', reviewed_at = unixepoch(), reviewer = ?
    WHERE id = ?
  `).run(ADMIN, req.params.id);

  // Deploy on-chain via MarketFactory
  try {
    const factory = req.app.get("marketFactory");
    const engine  = req.app.get("engine");
    const books   = req.app.get("books");
    const OrderBook = require("../orderbook/OrderBook").OrderBook;

    let market;
    if (row.type === "CRYPTO_PRICE") {
      market = await factory.createBtcMarket(row.duration);
    } else {
      market = await factory.createCustomMarket(row.question, row.duration);
    }

    books.set(market.yesToken, new OrderBook(market.yesToken));
    books.set(market.noToken,  new OrderBook(market.noToken));
    engine.registerPair(market.yesToken, market.noToken);

    db.prepare("UPDATE pending_markets SET status = 'DEPLOYED' WHERE id = ?").run(req.params.id);

    res.json({ ok: true, market });
  } catch (e) {
    db.prepare("UPDATE pending_markets SET status = 'APPROVED' WHERE id = ?").run(req.params.id);
    res.status(500).json({ error: e.message });
  }
});

// ── Admin: reject ────────────────────────────────────────────────────
router.post("/reject/:id", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Admin only" });

  const { reason = "Does not meet guidelines" } = req.body;
  const row = db.prepare("SELECT * FROM pending_markets WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Not found" });
  if (row.status !== "PENDING") return res.status(400).json({ error: `Already ${row.status}` });

  db.prepare(`
    UPDATE pending_markets SET status = 'REJECTED', reviewed_at = unixepoch(), reviewer = ?, reject_reason = ?
    WHERE id = ?
  `).run(ADMIN, reason, req.params.id);

  res.json({ ok: true });
});

module.exports = router;
