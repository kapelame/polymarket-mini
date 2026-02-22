"use client";
import { useEffect, useRef, useState } from "react";

interface PricePoint {
  t: number;
  p: number;
}

interface Props {
  entryPrice: number;
  expiration: number;
  marketResult?: "YES" | "NO" | null;
}

function fmt(p: number) {
  return p >= 10000 ? p.toFixed(2) : p.toFixed(2);
}

export default function LivePriceChart({ entryPrice, expiration, marketResult }: Props) {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const [points,    setPoints]    = useState<PricePoint[]>([]);
  const [current,   setCurrent]   = useState<number | null>(null);
  const [delta,     setDelta]     = useState<number>(0);
  const [secs,      setSecs]      = useState(() => Math.max(0, expiration - Math.floor(Date.now() / 1000)));
  const [connected, setConnected] = useState(false);
  const wsRef       = useRef<WebSocket | null>(null);
  const prevRef     = useRef<number | null>(null);

  // Countdown
  useEffect(() => {
    const id = setInterval(() => setSecs(Math.max(0, expiration - Math.floor(Date.now() / 1000))), 1000);
    return () => clearInterval(id);
  }, [expiration]);

  // OKX WebSocket for real-time price
  useEffect(() => {
    const connect = () => {
      const ws = new WebSocket("wss://ws.okx.com:8443/ws/v5/public");
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        ws.send(JSON.stringify({
          op: "subscribe",
          args: [{ channel: "tickers", instId: "BTC-USDT" }]
        }));
      };

      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data);
        if (!msg.data?.[0]?.last) return;
        const p = parseFloat(msg.data[0].last);
        prevRef.current = p;
        setCurrent(p);
        setDelta(p - entryPrice);
        setPoints(prev => [...prev, { t: Date.now(), p }].slice(-300));
      };

      ws.onclose = () => {
        setConnected(false);
        setTimeout(connect, 2000);
      };
      ws.onerror = () => ws.close();
    };

    connect();
    return () => wsRef.current?.close();
  }, [entryPrice]);

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || points.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width, H = canvas.height;
    const PAD_L = 80, PAD_R = 20, PAD_T = 16, PAD_B = 28;
    const cW = W - PAD_L - PAD_R;
    const cH = H - PAD_T - PAD_B;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#0d0e12";
    ctx.fillRect(0, 0, W, H);

    const prices  = points.map(p => p.p);
    const allP    = [...prices, entryPrice];
    let maxP      = Math.max(...allP);
    let minP      = Math.min(...allP);
    const pad     = (maxP - minP) * 0.3 || 5;
    maxP += pad; minP -= pad;
    const range   = maxP - minP;

    const toY = (p: number) => PAD_T + (1 - (p - minP) / range) * cH;
    const toX = (i: number) => PAD_L + (i / (points.length - 1)) * cW;

    // Grid lines
    for (let i = 0; i <= 4; i++) {
      const p = minP + (i / 4) * range;
      const y = toY(p);
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(PAD_L, y); ctx.lineTo(W - PAD_R, y); ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.3)";
      ctx.font = "10px monospace"; ctx.textAlign = "right";
      ctx.fillText("$" + p.toFixed(0), PAD_L - 6, y + 3);
    }

    // Entry price dashed line
    const entryY = toY(entryPrice);
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(234,57,67,0.7)";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(PAD_L, entryY); ctx.lineTo(W - PAD_R, entryY); ctx.stroke();
    ctx.setLineDash([]);
    // Entry label on right
    ctx.fillStyle = "rgba(234,57,67,0.9)";
    ctx.fillRect(W - PAD_R - 72, entryY - 9, 72, 17);
    ctx.fillStyle = "#fff"; ctx.font = "bold 10px monospace"; ctx.textAlign = "right";
    ctx.fillText("Target $" + fmt(entryPrice), W - PAD_R - 3, entryY + 4);

    // Price line gradient fill
    const isAbove = (current || entryPrice) >= entryPrice;
    const lineCol  = isAbove ? "#f59e0b" : "#ea3943";
    const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + cH);
    grad.addColorStop(0, isAbove ? "rgba(245,158,11,0.25)" : "rgba(234,57,67,0.25)");
    grad.addColorStop(1, "rgba(0,0,0,0)");

    ctx.beginPath();
    ctx.moveTo(toX(0), toY(prices[0]));
    prices.forEach((p, i) => i > 0 && ctx.lineTo(toX(i), toY(p)));
    ctx.lineTo(toX(prices.length - 1), PAD_T + cH);
    ctx.lineTo(toX(0), PAD_T + cH);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Price line
    ctx.beginPath();
    ctx.moveTo(toX(0), toY(prices[0]));
    prices.forEach((p, i) => i > 0 && ctx.lineTo(toX(i), toY(p)));
    ctx.strokeStyle = lineCol;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.stroke();

    // Dot at current price
    const lastX = toX(prices.length - 1);
    const lastY = toY(prices[prices.length - 1]);
    ctx.beginPath();
    ctx.arc(lastX, lastY, 5, 0, Math.PI * 2);
    ctx.fillStyle = lineCol;
    ctx.fill();
    // Pulse ring
    ctx.beginPath();
    ctx.arc(lastX, lastY, 9, 0, Math.PI * 2);
    ctx.strokeStyle = lineCol + "55";
    ctx.lineWidth = 2;
    ctx.stroke();

    // Delta annotations on the left
    const deltaStep = range / 4;
    for (let i = -3; i <= 3; i++) {
      const p = entryPrice + i * (range / 8);
      if (p < minP || p > maxP) continue;
      const y   = toY(p);
      const dif = p - entryPrice;
      if (Math.abs(dif) < 0.5) continue;
      ctx.fillStyle = dif > 0 ? "rgba(22,199,132,0.7)" : "rgba(234,57,67,0.7)";
      ctx.font = "10px monospace"; ctx.textAlign = "left";
      ctx.fillText((dif > 0 ? "+" : "") + "$" + Math.abs(dif).toFixed(0), 4, y + 3);
    }

    // Time axis
    const tStart = points[0].t, tEnd = points[points.length-1].t;
    const tRange = tEnd - tStart || 1;
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.font = "9px monospace"; ctx.textAlign = "center";
    const tStep = Math.max(1, Math.floor(points.length / 5));
    points.forEach((pt, i) => {
      if (i % tStep === 0) {
        const x = toX(i);
        const d = new Date(pt.t);
        const label = `${d.getHours().toString().padStart(2,"0")}:${d.getMinutes().toString().padStart(2,"0")}:${d.getSeconds().toString().padStart(2,"0")}`;
        ctx.fillText(label, x, H - 6);
      }
    });

  }, [points, entryPrice, current]);

  const mins = Math.floor(secs / 60);
  const ss   = secs % 60;
  const isAbove = (current || entryPrice) >= entryPrice;
  const settled = marketResult !== null && marketResult !== undefined;

  return (
    <div className="card" style={{ overflow: "hidden", background: "#0d0e12", border: "1px solid var(--border)" }}>
      {/* Header */}
      <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)", display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div style={{ display: "flex", gap: 32 }}>
          {/* Entry price */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 500, marginBottom: 3, letterSpacing: "0.05em" }}>PRICE TO BEAT</div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: "rgba(255,255,255,0.85)" }}>
              ${fmt(entryPrice)}
            </div>
          </div>

          {/* Current price */}
          <div>
            <div style={{ fontSize: 10, color: "rgba(255,255,255,0.4)", fontWeight: 500, marginBottom: 3, letterSpacing: "0.05em", display: "flex", alignItems: "center", gap: 4 }}>
              CURRENT PRICE
              {current && (
                <span style={{ color: isAbove ? "#f59e0b" : "#ea3943", fontWeight: 700 }}>
                  {isAbove ? "▲" : "▼"} ${Math.abs(delta).toFixed(2)}
                </span>
              )}
            </div>
            <div className="mono" style={{ fontSize: 22, fontWeight: 700, color: current ? (isAbove ? "#f59e0b" : "#ea3943") : "rgba(255,255,255,0.3)" }}>
              {current ? "$" + fmt(current) : "—"}
            </div>
          </div>
        </div>

        {/* Countdown */}
        <div style={{ textAlign: "right" }}>
          {settled ? (
            <div style={{ padding: "6px 14px", borderRadius: 8, background: marketResult === "YES" ? "rgba(22,199,132,0.15)" : "rgba(234,57,67,0.15)", border: `1px solid ${marketResult === "YES" ? "rgba(22,199,132,0.3)" : "rgba(234,57,67,0.3)"}` }}>
              <div style={{ fontSize: 11, color: "rgba(255,255,255,0.5)", marginBottom: 2 }}>RESULT</div>
              <div style={{ fontSize: 20, fontWeight: 800, color: marketResult === "YES" ? "#16c784" : "#ea3943" }}>
                {marketResult} {marketResult === "YES" ? "📈" : "📉"}
              </div>
            </div>
          ) : secs > 0 ? (
            <div>
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <div style={{ textAlign: "center" }}>
                  <div className="mono" style={{ fontSize: 32, fontWeight: 800, color: secs < 30 ? "#ea3943" : secs < 60 ? "#f59e0b" : "white", lineHeight: 1 }}>
                    {String(mins).padStart(2, "0")}
                  </div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em" }}>MINS</div>
                </div>
                <div style={{ fontSize: 28, fontWeight: 800, color: "rgba(255,255,255,0.3)", lineHeight: "36px" }}>:</div>
                <div style={{ textAlign: "center" }}>
                  <div className="mono" style={{ fontSize: 32, fontWeight: 800, color: secs < 30 ? "#ea3943" : secs < 60 ? "#f59e0b" : "white", lineHeight: 1 }}>
                    {String(ss).padStart(2, "0")}
                  </div>
                  <div style={{ fontSize: 9, color: "rgba(255,255,255,0.3)", letterSpacing: "0.08em" }}>SECS</div>
                </div>
              </div>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)" }}>⏳ Resolving...</div>
          )}
          {!settled && <div style={{ fontSize: 10, color: connected ? "rgba(22,199,132,0.6)" : "rgba(255,255,255,0.2)", marginTop: 6, textAlign: "right" }}>
            {connected ? "● LIVE" : "○ Connecting"}
          </div>}
        </div>
      </div>

      {/* Chart */}
      <div style={{ position: "relative" }}>
        <canvas
          ref={canvasRef} width={900} height={200}
          style={{ width: "100%", height: 200, display: "block" }}
        />
        {points.length < 2 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "#0d0e12" }}>
            <span style={{ fontSize: 13, color: "rgba(255,255,255,0.2)" }}>
              {connected ? "Waiting for price data..." : "Connecting to OKX..."}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
