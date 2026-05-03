import { buildHmacSig, CLOB_URL } from "./signing";

export interface ApiCreds {
  apiKey:     string;
  secret:     string;
  passphrase: string;
  address:    string;
}

export interface OrderLevel {
  price: number;
  size:  number;
}

export interface Orderbook {
  bids: OrderLevel[];
  asks: OrderLevel[];
}

export interface OpenOrder {
  order_id?: string;
  orderId?: string;
  id?: string;
  maker: string;
  token_id?: string;
  tokenId?: string;
  side: "BUY" | "SELL";
  price?: number | string;
  maker_amount?: string;
  taker_amount?: string;
  makerAmount?: string;
  takerAmount?: string;
  filled: string;
  status: string;
  created_at?: number;
  createdAt?: number;
}

let _creds: ApiCreds | null = null;
export function setCreds(c: ApiCreds) { _creds = c; }
export function getCreds() { return _creds; }

export function parseLevels(levels: any[]): OrderLevel[] {
  return (levels || []).map(l => ({
    price: parseFloat(l.price ?? l[0]),
    size:  normalizeSize(parseFloat(l.size  ?? l[1])),
  })).filter(l => !isNaN(l.price) && !isNaN(l.size));
}

function normalizeSize(size: number) {
  return size > 100000 ? size / 1e6 : size;
}

export async function fetchOrderbook(tokenId: string): Promise<Orderbook> {
  const r  = await fetch(`${CLOB_URL}/orderbook/${tokenId}`);
  const ob = await r.json();
  return {
    bids: parseLevels(ob.bids),
    asks: parseLevels(ob.asks),
  };
}

async function l2Headers(method: string, path: string, body = "") {
  if (!_creds) throw new Error("Not authenticated");
  const ts  = String(Math.floor(Date.now() / 1000));
  const sig = await buildHmacSig(_creds.secret, ts, method, path, body);
  return {
    "Content-Type":   "application/json",
    "poly_address":   _creds.address,
    "poly_api_key":   _creds.apiKey,
    "poly_timestamp": ts,
    "poly_signature": sig,
  };
}

export async function postOrder(order: object) {
  const body    = JSON.stringify(order);
  const headers = await l2Headers("POST", "/order", body);
  const r       = await fetch(`${CLOB_URL}/order`, { method: "POST", headers, body });
  return r.json();
}

export async function fetchOpenOrders(address: string): Promise<OpenOrder[]> {
  const headers = await l2Headers("GET", `/orders/${address}`);
  const r = await fetch(`${CLOB_URL}/orders/${address}`, { headers });
  const data = await r.json();
  if (data.error) throw new Error(data.error);
  return data;
}

export async function cancelOrder(orderId: string) {
  const headers = await l2Headers("DELETE", `/order/${orderId}`);
  const r = await fetch(`${CLOB_URL}/order/${encodeURIComponent(orderId)}`, { method: "DELETE", headers });
  return r.json();
}

export async function getApiKey(address: string, timestamp: string, nonce: number, signature: string) {
  const r = await fetch(`${CLOB_URL}/auth/api-key`, {
    method: "POST",
    headers: {
      "poly_address":   address,
      "poly_timestamp": timestamp,
      "poly_nonce":     String(nonce),
      "poly_signature": signature,
    },
  });
  return r.json();
}
