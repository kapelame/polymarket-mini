"use client";
import { useEffect, useRef, useState, useCallback } from "react";

interface Candle {
  t: number; o: number; h: number; l: number; c: number; closed: boolean;
}

const INTERVALS = ["1m","5m","15m","1h"] as const;
type Interval = typeof INTERVALS[number];

// OKX bar values
const OKX_BAR: Record<Interval, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "1h": "1H"
};

function fmt(p: number) {
  return p >= 10000 ? p.toFixed(0) : p >= 1000 ? p.toFixed(1) : p.toFixed(2);
}

function fmtTime(ts: number, interval: Interval) {
  const d = new Date(ts);
  if (interval === "1h") return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:00`;
  return `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}`;
}

interface Props {
  entryPrice?: number;
  marketResult?: "YES" | "NO" | null;
  height?: number;
}

export default function CandleChart({ entryPrice, marketResult, height = 300 }: Props) {
  const canvasRef  = useRef<HTMLCanvasElement>(null);
  const [candles,  setCandles]  = useState<Candle[]>([]);
  const [interval, setInterval] = useState<Interval>("1m");
  const [offset,   setOffset]   = useState(0);
  const [price,    setPrice]    = useState<number | null>(null);
  const [priceDir, setPriceDir] = useState<1|-1>(1);
  const [status,   setStatus]   = useState("Connecting...");
  const prevPrice  = useRef<number | null>(null);
  const dragging   = useRef(false);
  const dragStart  = useRef(0);
  const dragOffset = useRef(0);
  const wsRef      = useRef<WebSocket | null>(null);

  // Fetch historical candles from OKX REST
  useEffect(() => {
    setCandles([]); setOffset(0); setStatus("Loading...");
    const load = async () => {
      try {
        const r = await fetch(
          `https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=${OKX_BAR[interval]}&limit=100`
        );
        const d = await r.json();
        if (d.data) {
          // OKX returns [ts, o, h, l, c, vol, ...] newest first
          const cs: Candle[] = d.data.reverse().map((k: string[]) => ({
            t: parseInt(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], closed: k[8] === "1"
          }));
          setCandles(cs);
          const last = cs[cs.length-1]?.c;
          if (last) { setPrice(last); prevPrice.current = last; }
          setStatus("");
        }
      } catch { setStatus("Failed to load"); }
    };
    load();
  }, [interval]);

  // OKX WebSocket
  useEffect(() => {
    wsRef.current?.close();
    setStatus("Connecting...");
    const ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");
    wsRef.current = ws;

    ws.onopen = () => {
      ws.send(JSON.stringify({
        op: "subscribe",
        args: [{ channel: "candle" + OKX_BAR[interval], instId: "BTC-USDT" }]
      }));
      setStatus("");
    };

    ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      if (!msg.data) return;
      const k = msg.data[0];
      // OKX candle: [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm]
      const candle: Candle = {
        t: parseInt(k[0]), o: +k[1], h: +k[2], l: +k[3], c: +k[4], closed: k[8] === "1"
      };
      const p = candle.c;
      if (prevPrice.current !== null) setPriceDir(p >= prevPrice.current ? 1 : -1);
      prevPrice.current = p;
      setPrice(p);
      setCandles(prev => {
        if (!prev.length) return [candle];
        const last = prev[prev.length - 1];
        if (candle.t > last.t) return [...prev.slice(-99), candle];
        return [...prev.slice(0, -1), candle];
      });
    };

    ws.onerror = () => setStatus("WS error");
    ws.onclose = () => {};
    return () => ws.close();
  }, [interval]);

  // Draw candles
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || candles.length === 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    const PAD_L = 70, PAD_R = 10, PAD_T = 14, PAD_B = 28;
    const chartW = W - PAD_L - PAD_R;
    const chartH = H - PAD_T - PAD_B;
    const CW = 10, GAP = 4, STEP = CW + GAP;

    const visCount = Math.floor(chartW / STEP);
    const total    = candles.length;
    const start    = Math.max(0, total - visCount - offset);
    const end      = Math.max(0, total - offset);
    const vis      = candles.slice(start, end);
    if (!vis.length) return;

    let maxP = Math.max(...vis.map(c => c.h));
    let minP = Math.min(...vis.map(c => c.l));
    if (entryPrice) { maxP = Math.max(maxP, entryPrice * 1.003); minP = Math.min(minP, entryPrice * 0.997); }
    const range = maxP - minP || 1;
    const toY = (p: number) => PAD_T + (1 - (p - minP) / range) * chartH;
    const toX = (i: number) => PAD_L + i * STEP + CW / 2;

    // Background
    ctx.fillStyle = "#13141a";
    ctx.fillRect(0, 0, W, H);

    // Grid + price labels
    for (let i = 0; i <= 5; i++) {
      const y = PAD_T + (i / 5) * chartH;
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
      const p = maxP - (i / 5) * range;
      ctx.fillStyle = "rgba(255,255,255,0.35)";
      ctx.font = "10px monospace"; ctx.textAlign = "right";
      ctx.fillText(fmt(p), PAD_L - 4, y + 3);
    }

    // Entry price dashed line
    if (entryPrice && entryPrice >= minP && entryPrice <= maxP) {
      const y = toY(entryPrice);
      const col = marketResult === "YES" ? "#16c784" : marketResult === "NO" ? "#ea3943" : "#f59e0b";
      ctx.setLineDash([4, 4]);
      ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = col; ctx.font = "bold 10px monospace"; ctx.textAlign = "right";
      ctx.fillText("$" + fmt(entryPrice), PAD_L - 4, y - 3);
    }

    // Candles
    vis.forEach((c, i) => {
      const x = toX(i);
      const bull = c.c >= c.o;
      const col  = bull ? "#16c784" : "#ea3943";
      const oY = toY(c.o), cY = toY(c.c), hY = toY(c.h), lY = toY(c.l);
      ctx.strokeStyle = col; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, hY); ctx.lineTo(x, lY); ctx.stroke();
      ctx.fillStyle = bull ? "rgba(22,199,132,0.85)" : "rgba(234,57,67,0.85)";
      const bTop = Math.min(oY, cY), bH = Math.max(1, Math.abs(cY - oY));
      ctx.fillRect(x - CW/2, bTop, CW, bH);
    });

    // Time axis
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.font = "9px monospace"; ctx.textAlign = "center";
    const step = Math.max(1, Math.floor(vis.length / 6));
    vis.forEach((c, i) => { if (i % step === 0) ctx.fillText(fmtTime(c.t, interval), toX(i), H - 8); });

    // Current price tag
    if (price) {
      const y = toY(price);
      if (y >= PAD_T && y <= PAD_T + chartH) {
        ctx.strokeStyle = "rgba(255,255,255,0.12)"; ctx.lineWidth = 1; ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
        ctx.setLineDash([]);
        const tagCol = priceDir >= 0 ? "#16c784" : "#ea3943";
        ctx.fillStyle = tagCol;
        ctx.fillRect(W - PAD_R - 70, y - 9, 70, 18);
        ctx.fillStyle = "#fff"; ctx.font = "bold 10px monospace"; ctx.textAlign = "right";
        ctx.fillText("$" + fmt(price), W - PAD_R - 3, y + 4);
      }
    }
  }, [candles, offset, entryPrice, marketResult, price, priceDir, interval]);

  // Pan handlers
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    dragging.current = true; dragStart.current = e.clientX; dragOffset.current = offset;
  }, [offset]);
  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    setOffset(Math.max(0, dragOffset.current - Math.round((e.clientX - dragStart.current) / 14)));
  }, []);
  const onMouseUp = useCallback(() => { dragging.current = false; }, []);
  const onWheel   = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    setOffset(prev => Math.max(0, prev + Math.round(e.deltaY / 30)));
  }, []);

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontWeight: 600, fontSize: 13 }}>BTC/USDT</span>
          {price && (
            <span className="mono" style={{ fontSize: 16, fontWeight: 700, color: priceDir >= 0 ? "var(--green)" : "var(--red)" }}>
              ${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}
          {entryPrice && <span style={{ fontSize: 11, color: "var(--amber,#f59e0b)", marginLeft: 4 }}>entry ${fmt(entryPrice)}</span>}
          {status && <span style={{ fontSize: 11, color: "var(--text3)" }}>{status}</span>}
        </div>
        <div style={{ display: "flex", gap: 3 }}>
          {INTERVALS.map(iv => (
            <button key={iv} onClick={() => setInterval(iv)} className="btn"
              style={{ padding: "3px 10px", fontSize: 11, fontWeight: 600, borderRadius: 5, border: "none",
                background: interval === iv ? "#3b82f6" : "var(--surface2)",
                color: interval === iv ? "white" : "var(--text2)" }}>
              {iv}
            </button>
          ))}
        </div>
      </div>
      <div style={{ position: "relative", cursor: dragging.current ? "grabbing" : "grab" }}>
        <canvas
          ref={canvasRef} width={900} height={height}
          style={{ width: "100%", height, display: "block" }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove}
          onMouseUp={onMouseUp} onMouseLeave={onMouseUp} onWheel={onWheel}
        />
        {candles.length === 0 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#13141a" }}>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.3)" }}>{status || "Loading..."}</span>
          </div>
        )}
        <div style={{ position: "absolute", bottom: 32, right: 12, fontSize: 10, color: "rgba(255,255,255,0.15)", pointerEvents: "none" }}>
          drag to pan · scroll to shift
        </div>
      </div>
    </div>
  );
}
