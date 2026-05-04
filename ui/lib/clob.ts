import { AUTH_DOMAIN, AUTH_MSG, AUTH_TYPES, buildHmacSig, CHAIN_ID, CLOB_URL } from "./signing";

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

export interface AccountSummary {
  totalPnl: number;
  openPnl: number;
  settledPnl: number;
  totalVolume: number;
  positionValue: number;
  tradeCount: number;
  openOrderCount: number;
  filledOrderCount: number;
  marketsTraded: number;
}

export interface AccountPosition {
  marketId: string | null;
  question: string;
  outcome: "YES" | "NO";
  status: "OPEN" | "SETTLED" | "ERROR";
  result?: "YES" | "NO" | null;
  tokenId: string;
  shares: number;
  avgPrice: number;
  currentPrice: number;
  cost: number;
  value: number;
  pnl: number;
  createdAt?: number;
}

export interface AccountTrade {
  tradeId: string;
  orderId: string;
  marketId: string | null;
  question: string;
  outcome: "YES" | "NO";
  tokenId: string;
  side: "BUY" | "SELL";
  price: number;
  shares: number;
  notional: number;
  pnl: number;
  status: "OPEN" | "SETTLED" | "ERROR";
  result?: "YES" | "NO" | null;
  txHash?: string;
  createdAt?: number;
}

export interface AccountOrder {
  orderId: string;
  marketId: string | null;
  question: string;
  outcome: "YES" | "NO";
  tokenId: string;
  side: "BUY" | "SELL";
  status: "OPEN" | "FILLED" | "CANCELLED" | "PARTIAL";
  price: number;
  shares: number;
  notional: number;
  filled: number;
  createdAt?: number;
}

export interface AccountDashboard {
  address: string;
  summary: AccountSummary;
  positions: AccountPosition[];
  trades: AccountTrade[];
  orders: AccountOrder[];
}

type SignTypedData = (args: any) => Promise<string>;

let _creds: ApiCreds | null = null;
export function setCreds(c: ApiCreds) { _creds = c; }
export function getCreds() { return _creds; }

export async function ensureApiCreds(address: string, signTypedDataAsync: SignTypedData): Promise<ApiCreds> {
  if (getCreds()?.address === address) return getCreds()!;
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await signTypedDataAsync({
    domain: { ...AUTH_DOMAIN, chainId: CHAIN_ID },
    types: AUTH_TYPES,
    primaryType: "ClobAuth",
    message: { address, timestamp, nonce: 0, message: AUTH_MSG },
  });
  const creds = await getApiKey(address, timestamp, 0, signature);
  if (creds.error) throw new Error(creds.error);
  const enriched = { ...creds, address };
  setCreds(enriched);
  return enriched;
}

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

export async function fetchAccountDashboard(address: string): Promise<AccountDashboard> {
  const headers = await l2Headers("GET", `/account/${address}`);
  const r = await fetch(`${CLOB_URL}/account/${address}`, { headers });
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
