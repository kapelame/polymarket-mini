"use client";

import { useEffect, useRef, useState } from "react";
import { CLOB_URL } from "../lib/signing";

interface Fill {
  time: string;
  side: string;
  price: string;
  size: string;
}

const WS_URL = CLOB_URL.replace(/^http/, "ws");

export default function TradeHistory({ yesToken }: { yesToken?: string }) {
  const [fills, setFills] = useState<Fill[]>([]);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!yesToken) return;
      try {
        const response = await fetch(`${CLOB_URL}/trades/${yesToken}?limit=30`);
        const data = await response.json();
        if (!cancelled && Array.isArray(data)) {
          setFills(data.map((trade) => ({
            time: new Date((trade.created_at || Date.now() / 1000) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            side: "FILL",
            price: `${Math.round(Number(trade.price || 0) * 100)}c`,
            size: (Number(trade.size || 0) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }),
          })));
        }
      } catch {}
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [yesToken]);

  useEffect(() => {
    try {
      ws.current = new WebSocket(WS_URL);
      ws.current.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === "fill" && (!yesToken || msg.tokenId === yesToken)) {
          setFills((current) => [{
            time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            side: msg.side || "FILL",
            price: `${Math.round(Number(msg.price || 0) * 100)}c`,
            size: ((Number(msg.makerFill || msg.size || 0)) / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 }),
          }, ...current].slice(0, 30));
        }
      };
    } catch {}
    return () => ws.current?.close();
  }, [yesToken]);

  return (
    <div className="book-panel">
      <div className="panel-heading">
        <h2>Trades</h2>
        <span className="subtle">{fills.length} fills</span>
      </div>
      <div className="table-head" style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
        <span>Time</span>
        <span>Price</span>
        <span>Shares</span>
        <span style={{ textAlign: "right" }}>Side</span>
      </div>
      {fills.length === 0 ? (
        <div style={{ padding: 28, textAlign: "center" }}>
          <span className="subtle">No trades yet.</span>
        </div>
      ) : (
        fills.map((fill, index) => (
          <div className="trade-row" key={`${fill.time}-${index}`} style={{ gridTemplateColumns: "1fr 1fr 1fr 1fr" }}>
            <span>{fill.time}</span>
            <span className="mono" style={{ color: fill.side === "SELL" ? "var(--red)" : "var(--green)", fontWeight: 700 }}>{fill.price}</span>
            <span className="mono">{fill.size}</span>
            <span style={{ textAlign: "right", color: "var(--text3)", fontWeight: 700 }}>{fill.side}</span>
          </div>
        ))
      )}
    </div>
  );
}
