const db     = require("./database");
const crypto = require("crypto");

const insert = db.prepare(`
  INSERT INTO trades (trade_id, maker_order, taker_order, token_id, price, size, tx_hash)
  VALUES (@tradeId, @makerOrder, @takerOrder, @tokenId, @price, @size, @txHash)
`);

const recent = db.prepare(`
  SELECT * FROM trades WHERE token_id = @tokenId ORDER BY created_at DESC LIMIT @limit
`);

const all = db.prepare(`
  SELECT * FROM trades ORDER BY created_at DESC LIMIT @limit
`);

module.exports = {
  save({ makerOrderId, takerOrderId, tokenId, price, size, txHash }) {
    const tradeId = crypto.randomUUID();
    insert.run({
      tradeId,
      makerOrder: makerOrderId,
      takerOrder: takerOrderId,
      tokenId,
      price,
      size,
      txHash: txHash || null,
    });
    return tradeId;
  },

  getRecent(tokenId, limit = 50) {
    return recent.all({ tokenId, limit });
  },

  getAll(limit = 100) {
    return all.all({ limit });
  },
};
