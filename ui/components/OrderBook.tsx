"use client";

import { useEffect, useRef, useState } from "react";
import { CLOB_URL } from "../lib/signing";
import { fetchOrderbook, parseLevels, type OrderLevel } from "../lib/clob";

const MAX = 9;
const WS_URL = CLOB_URL.replace(/^http/, "ws");

function Row({ level, side, maxSize }: { level: OrderLevel; side: "bid" | "ask"; maxSize: number }) {
  const isAsk = side === "ask";
  const color = isAsk ? "var(--red)" : "var(--green)";
  const width = `${Math.min(100, (level.size / Math.max(maxSize, 1)) * 100)}%`;
  return (
    <div className="book-row">
      <span className="depth-fill" style={{ width, right: isAsk ? 0 : "auto", left: isAsk ? "auto" : 0, background: isAsk ? "rgba(229,72,77,0.12)" : "rgba(0,167,111,0.12)" }} />
      <span className="mono" style={{ color, fontWeight: 700 }}>{Math.round(level.price * 100)}c</span>
      <span className="mono" style={{ textAlign: "center" }}>{level.size.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
      <span className="mono" style={{ textAlign: "right", color: "var(--text3)" }}>{(level.price * level.size).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
    </div>
  );
}

export default function OrderBook({ tokenId, yesToken, label = "YES" }: { tokenId?: string; yesToken?: string; label?: string }) {
  const activeToken = tokenId || yesToken || "";
  const [bids, setBids] = useState<OrderLevel[]>([]);
  const [asks, setAsks] = useState<OrderLevel[]>([]);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!activeToken) return;
    setBids([]);
    setAsks([]);
    fetchOrderbook(activeToken).then((book) => {
      setBids(book.bids.slice(0, MAX));
      setAsks(book.asks.slice(0, MAX));
    }).catch(() => {});

    ws.current?.close();
    try {
      ws.current = new WebSocket(WS_URL);
      ws.current.onopen = () => ws.current?.send(JSON.stringify({ type: "subscribe", channel: "market", tokenId: activeToken }));
      ws.current.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if ((msg.type === "orderbook_snapshot" || msg.type === "orderbook_update") && msg.tokenId === activeToken) {
          setBids(parseLevels(msg.data.bids).slice(0, MAX));
          setAsks(parseLevels(msg.data.asks).slice(0, MAX));
        }
      };
    } catch {}
    return () => ws.current?.close();
  }, [activeToken]);

  const spread = bids[0] && asks[0] ? asks[0].price - bids[0].price : null;
  const midPrice = bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : null;
  const maxBid = Math.max(...bids.map((bid) => bid.size), 1);
  const maxAsk = Math.max(...asks.map((ask) => ask.size), 1);

  return (
    <div className="book-panel">
      <div className="panel-heading">
        <h2>Order book</h2>
        <span className="subtle">{label}</span>
      </div>
      <div className="table-head">
        <span>Price</span>
        <span style={{ textAlign: "center" }}>Shares</span>
        <span style={{ textAlign: "right" }}>Total</span>
      </div>
      <div style={{ padding: "5px 0" }}>
        {[...asks].reverse().map((ask, index) => <Row key={`ask-${index}`} level={ask} side="ask" maxSize={maxAsk} />)}
      </div>
      <div className="book-mid">
        <strong className="mono">{midPrice !== null ? `${Math.round(midPrice * 100)}c` : "--"}</strong>
        <span className="subtle">{spread !== null ? `Spread ${(spread * 100).toFixed(1)}c` : "Waiting for orders"}</span>
      </div>
      <div style={{ padding: "5px 0" }}>
        {bids.map((bid, index) => <Row key={`bid-${index}`} level={bid} side="bid" maxSize={maxBid} />)}
      </div>
      {bids.length === 0 && asks.length === 0 && (
        <div style={{ padding: 24, textAlign: "center" }}>
          <span className="subtle">No orders on this outcome yet.</span>
        </div>
      )}
    </div>
  );
}
