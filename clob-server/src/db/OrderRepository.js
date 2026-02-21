const db = require("./database");

const insert = db.prepare(`
  INSERT OR IGNORE INTO orders
    (order_id, maker, token_id, side, price, maker_amount, taker_amount, salt, signature, raw_order)
  VALUES
    (@orderId, @maker, @tokenId, @side, @price, @makerAmount, @takerAmount, @salt, @signature, @rawOrder)
`);

const updateStatus = db.prepare(`
  UPDATE orders SET status = @status, filled = @filled, updated_at = unixepoch()
  WHERE order_id = @orderId
`);

const getOpen = db.prepare(`
  SELECT * FROM orders WHERE token_id = @tokenId AND status IN ('OPEN','PARTIAL')
  ORDER BY
    CASE WHEN side='BUY' THEN price END DESC,
    CASE WHEN side='SELL' THEN price END ASC,
    created_at ASC
`);

const getById = db.prepare(`SELECT * FROM orders WHERE order_id = @orderId`);

const getByMaker = db.prepare(`
  SELECT * FROM orders WHERE maker = @maker ORDER BY created_at DESC LIMIT 50
`);

module.exports = {
  save(order) {
    const price = order.side === "BUY"
      ? parseInt(order.takerAmount) / parseInt(order.makerAmount)
      : parseInt(order.makerAmount) / parseInt(order.takerAmount);

    insert.run({
      orderId:     order.orderId,
      maker:       order.maker,
      tokenId:     order.tokenId,
      side:        order.side,
      price:       price,
      makerAmount: order.makerAmount,
      takerAmount: order.takerAmount,
      salt:        order.salt,
      signature:   order.signature,
      rawOrder:    JSON.stringify(order),
    });
  },

  updateStatus(orderId, status, filled = "0") {
    updateStatus.run({ orderId, status, filled });
  },

  getOpen(tokenId) {
    return getOpen.all({ tokenId }).map(r => JSON.parse(r.raw_order));
  },

  getById(orderId) {
    const r = getById.get({ orderId });
    return r ? JSON.parse(r.raw_order) : null;
  },

  getByMaker(maker) {
    return getByMaker.all({ maker }).map(r => ({
      ...JSON.parse(r.raw_order),
      status:    r.status,
      filled:    r.filled,
      createdAt: r.created_at,
    }));
  },
};
