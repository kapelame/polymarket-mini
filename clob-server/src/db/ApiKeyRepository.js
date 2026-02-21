const db = require("./database");

const upsert = db.prepare(`
  INSERT INTO api_keys (address, api_key, secret, passphrase)
  VALUES (@address, @apiKey, @secret, @passphrase)
  ON CONFLICT(address) DO UPDATE SET
    api_key    = excluded.api_key,
    secret     = excluded.secret,
    passphrase = excluded.passphrase
`);

const byAddress = db.prepare(`SELECT * FROM api_keys WHERE address = @address`);
const byKey     = db.prepare(`SELECT * FROM api_keys WHERE api_key = @apiKey`);

module.exports = {
  save({ address, apiKey, secret, passphrase }) {
    upsert.run({ address, apiKey, secret, passphrase });
  },

  getByAddress(address) {
    return byAddress.get({ address }) || null;
  },

  getByKey(apiKey) {
    return byKey.get({ apiKey }) || null;
  },
};
