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

const byMaker = db.prepare(`
  SELECT
    t.*,
    mo.maker AS maker_address,
    ta.maker AS taker_address,
    mo.raw_order AS maker_raw_order,
    ta.raw_order AS taker_raw_order
  FROM trades t
  JOIN orders mo ON mo.order_id = t.maker_order
  JOIN orders ta ON ta.order_id = t.taker_order
  WHERE lower(mo.maker) = lower(@maker) OR lower(ta.maker) = lower(@maker)
  ORDER BY t.created_at DESC
  LIMIT @limit
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

  getByMaker(maker, limit = 100) {
    return byMaker.all({ maker, limit });
  },
};
