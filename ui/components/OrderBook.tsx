"use client";
import { useEffect, useState, useRef } from "react";
import { fetchOrderbook, parseLevels, type OrderLevel } from "../lib/clob";
import { YES_TOKEN } from "../lib/signing";

const MAX_LEVELS = 8;

function Row({ level, side, maxSize }: { level: OrderLevel; side: "bid"|"ask"; maxSize: number }) {
  const pct    = (level.size / maxSize) * 100;
  const isAsk  = side === "ask";
  const color  = isAsk ? "var(--red)" : "var(--green)";
  const bgColor = isAsk ? "rgba(234,57,67,0.08)" : "rgba(22,199,132,0.08)";

  return (
    <div style={{
      display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
      padding: "4px 12px", position: "relative", cursor: "pointer",
      transition: "background 0.1s",
    }}
    onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
    onMouseLeave={e => (e.currentTarget.style.background = "")}>
      {/* Depth bar */}
      <div style={{
        position: "absolute", inset: 0, opacity: 0.5,
        background: bgColor,
        width: `${pct}%`,
        right: isAsk ? 0 : "auto",
        left: isAsk ? "auto" : 0,
      }} />
      <span className="mono" style={{ fontSize: 12, color, zIndex: 1, fontWeight: 500 }}>
        {level.price.toFixed(4)}
      </span>
      <span className="mono" style={{ fontSize: 12, color: "var(--text2)", zIndex: 1, textAlign: "center" }}>
        {level.size.toLocaleString()}
      </span>
      <span className="mono" style={{ fontSize: 12, color: "var(--text3)", zIndex: 1, textAlign: "right" }}>
        ${(level.price * level.size).toFixed(0)}
      </span>
    </div>
  );
}

export default function OrderBook() {
  const [bids, setBids] = useState<OrderLevel[]>([]);
  const [asks, setAsks] = useState<OrderLevel[]>([]);
  const ws = useRef<WebSocket | null>(null);

  const load = async () => {
    try {
      const ob = await fetchOrderbook(YES_TOKEN);
      setBids(ob.bids.slice(0, MAX_LEVELS));
      setAsks(ob.asks.slice(0, MAX_LEVELS));
    } catch {}
  };

  useEffect(() => {
    load();
    try {
      ws.current = new WebSocket("ws://localhost:3000");
      ws.current.onopen = () => {
        ws.current?.send(JSON.stringify({ type: "subscribe", channel: "market", tokenId: YES_TOKEN }));
      };
      ws.current.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "orderbook_snapshot" || msg.type === "orderbook_update") {
          setBids(parseLevels(msg.data.bids).slice(0, MAX_LEVELS));
          setAsks(parseLevels(msg.data.asks).slice(0, MAX_LEVELS));
        }
      };
    } catch {}
    return () => ws.current?.close();
  }, []);

  const spread   = bids[0] && asks[0] ? asks[0].price - bids[0].price : null;
  const midPrice = bids[0] && asks[0] ? (bids[0].price + asks[0].price) / 2 : null;
  const maxBid   = Math.max(...bids.map(b => b.size), 1);
  const maxAsk   = Math.max(...asks.map(a => a.size), 1);

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "14px 12px 10px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Order Book</span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>YES</span>
      </div>

      {/* Column headers */}
      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
        padding: "6px 12px",
        borderBottom: "1px solid var(--border)",
      }}>
        {["Price", "Size", "Total"].map((h, i) => (
          <span key={h} style={{
            fontSize: 11, color: "var(--text3)", fontWeight: 500,
            textAlign: i === 1 ? "center" : i === 2 ? "right" : "left",
          }}>{h}</span>
        ))}
      </div>

      {/* Asks (reversed — lowest ask at bottom) */}
      <div style={{ padding: "4px 0" }}>
        {[...asks].reverse().map((a, i) => (
          <Row key={i} level={a} side="ask" maxSize={maxAsk} />
        ))}
      </div>

      {/* Spread */}
      <div style={{
        borderTop: "1px solid var(--border)",
        borderBottom: "1px solid var(--border)",
        padding: "8px 12px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
        background: "var(--surface2)",
      }}>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>
          {midPrice !== null ? midPrice.toFixed(4) : "—"}
        </span>
        {spread !== null && (
          <span style={{ fontSize: 11, color: "var(--text3)" }}>
            Spread: {(spread * 100).toFixed(2)}¢
          </span>
        )}
      </div>

      {/* Bids */}
      <div style={{ padding: "4px 0" }}>
        {bids.map((b, i) => (
          <Row key={i} level={b} side="bid" maxSize={maxBid} />
        ))}
      </div>

      {bids.length === 0 && asks.length === 0 && (
        <div style={{ padding: "24px 12px", textAlign: "center" }}>
          <span style={{ fontSize: 12, color: "var(--text3)" }}>No orders yet</span>
        </div>
      )}
    </div>
  );
}
