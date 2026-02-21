const crypto = require("crypto");

function buildHmacSignature(secret, timestamp, method, path, body = "") {
    const message = `${timestamp}${method.toUpperCase()}${path}${body}`;
    return crypto.createHmac("sha256", Buffer.from(secret, "base64"))
        .update(message).digest("base64");
}

function verifyL2Headers(req, apiKeys) {
    const address   = req.headers["poly_address"];
    const apiKey    = req.headers["poly_api_key"];
    const timestamp = req.headers["poly_timestamp"];
    const signature = req.headers["poly_signature"];

    if (!address || !apiKey || !timestamp || !signature) {
        throw new Error("Missing auth headers");
    }
    const age = Date.now() / 1000 - parseInt(timestamp);
    if (age > 30)  throw new Error("Request timestamp too old");
    if (age < -10) throw new Error("Request timestamp in future");

    const creds = apiKeys.get(apiKey);
    if (!creds) throw new Error("Unknown API key");
    if (creds.address.toLowerCase() !== address.toLowerCase()) {
        throw new Error("API key does not belong to this address");
    }

    const body     = req.body ? JSON.stringify(req.body) : "";
    const expected = buildHmacSignature(creds.secret, timestamp, req.method, req.path, body);
    if (expected !== signature) throw new Error("Invalid HMAC signature");

    return creds;
}

module.exports = { buildHmacSignature, verifyL2Headers };
