"use client";
import { useEffect, useRef, useState } from "react";

interface Fill {
  time:  string;
  side:  string;
  price: string;
  size:  string;
}

export default function TradeHistory() {
  const [fills, setFills] = useState<Fill[]>([]);
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    try {
      ws.current = new WebSocket("ws://localhost:3000");
      ws.current.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (msg.type === "fill") {
          setFills(prev => [{
            time:  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
            side:  msg.data.side,
            price: parseFloat(msg.data.price).toFixed(4),
            size:  (parseInt(msg.data.size) / 1e6).toLocaleString(),
          }, ...prev].slice(0, 30));
        }
      };
    } catch {}
    return () => ws.current?.close();
  }, []);

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{
        padding: "14px 16px",
        borderBottom: "1px solid var(--border)",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Trade History</span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>{fills.length} fills</span>
      </div>

      <div style={{
        display: "grid", gridTemplateColumns: "1fr 1fr 1fr 80px",
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
      }}>
        {["Time", "Price", "Shares", "Side"].map((h, i) => (
          <span key={h} style={{
            fontSize: 11, color: "var(--text3)", fontWeight: 500,
            textAlign: i === 3 ? "right" : "left",
          }}>{h}</span>
        ))}
      </div>

      <div style={{ maxHeight: 280, overflowY: "auto" }}>
        {fills.length === 0 ? (
          <div style={{ padding: "32px 16px", textAlign: "center" }}>
            <div style={{ fontSize: 13, color: "var(--text3)" }}>No trades yet</div>
            <div style={{ fontSize: 12, color: "var(--text3)", marginTop: 4 }}>
              Place an order to see trades appear here
            </div>
          </div>
        ) : fills.map((f, i) => (
          <div key={i} style={{
            display: "grid", gridTemplateColumns: "1fr 1fr 1fr 80px",
            padding: "8px 16px",
            borderBottom: "1px solid var(--border)",
            transition: "background 0.1s",
          }}
          onMouseEnter={e => (e.currentTarget.style.background = "var(--surface2)")}
          onMouseLeave={e => (e.currentTarget.style.background = "")}>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>{f.time}</span>
            <span className="mono" style={{
              fontSize: 12,
              color: f.side === "BUY" ? "var(--green)" : "var(--red)",
              fontWeight: 500,
            }}>{f.price}</span>
            <span className="mono" style={{ fontSize: 12, color: "var(--text2)" }}>{f.size}</span>
            <span style={{
              fontSize: 11, fontWeight: 600, textAlign: "right",
              color: f.side === "BUY" ? "var(--green)" : "var(--red)",
            }}>{f.side}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
