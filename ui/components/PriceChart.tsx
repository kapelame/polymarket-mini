"use client";
import { useEffect, useRef, useState } from "react";
import { fetchOrderbook } from "../lib/clob";

interface Props { yesToken: string; question?: string; }

export default function PriceChart({ yesToken, question }: Props) {
  const [yesPrice, setYesPrice] = useState<number | null>(null);
  const [noPrice,  setNoPrice]  = useState<number | null>(null);
  const [history,  setHistory]  = useState<{t: number, p: number}[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => { setHistory([]); setYesPrice(null); setNoPrice(null); }, [yesToken]);

  useEffect(() => {
    const load = async () => {
      try {
        const ob = await fetchOrderbook(yesToken);
        if (ob.bids[0] && ob.asks[0]) {
          const mid = (ob.bids[0].price + ob.asks[0].price) / 2;
          setYesPrice(mid); setNoPrice(1 - mid);
          setHistory(prev => [...prev, { t: Date.now(), p: mid }].slice(-60));
        }
      } catch {}
    };
    load();
    const id = setInterval(load, 2000);
    return () => clearInterval(id);
  }, [yesToken]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    const { width, height } = canvas;
    ctx.clearRect(0, 0, width, height);
    const prices = history.map(h => h.p);
    const min = Math.min(...prices) - 0.02, max = Math.max(...prices) + 0.02, range = max - min || 0.1;
    const toX = (i: number) => (i / (history.length - 1)) * width;
    const toY = (p: number) => height - ((p - min) / range) * height;
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, "rgba(22,199,132,0.2)"); grad.addColorStop(1, "rgba(22,199,132,0)");
    ctx.beginPath(); ctx.moveTo(toX(0), toY(prices[0]));
    prices.forEach((p, i) => i > 0 && ctx.lineTo(toX(i), toY(p)));
    ctx.lineTo(toX(prices.length - 1), height); ctx.lineTo(0, height); ctx.closePath();
    ctx.fillStyle = grad; ctx.fill();
    ctx.beginPath(); ctx.moveTo(toX(0), toY(prices[0]));
    prices.forEach((p, i) => i > 0 && ctx.lineTo(toX(i), toY(p)));
    ctx.strokeStyle = "#16c784"; ctx.lineWidth = 2; ctx.stroke();
  }, [history]);

  const shortQ = (question || "Market").split("(")[0].split("t=")[0].trim();

  return (
    <div className="card" style={{ padding: 24, marginBottom: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 18, fontWeight: 600, marginBottom: 4 }}>{shortQ}</h1>
          <div style={{ display: "flex", gap: 8 }}>
            <span style={{ fontSize: 12, color: "var(--text3)", background: "var(--surface2)", padding: "2px 8px", borderRadius: 4 }}>Crypto</span>
            <span style={{ fontSize: 12, color: "var(--text3)" }}>Anvil Testnet</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 12 }}>
          {[
            { label: "YES", price: yesPrice, color: "var(--green)", bg: "var(--green-bg)" },
            { label: "NO",  price: noPrice,  color: "var(--red)",   bg: "var(--red-bg)"  },
          ].map(({ label, price, color, bg }) => (
            <div key={label} style={{ background: bg, border: `1px solid ${color}22`, borderRadius: 10, padding: "12px 20px", textAlign: "center", minWidth: 90 }}>
              <div style={{ fontSize: 11, color, fontWeight: 500, marginBottom: 4 }}>{label}</div>
              <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1 }}>{price !== null ? `${Math.round(price * 100)}¢` : "—"}</div>
              <div style={{ fontSize: 11, color: "var(--text3)", marginTop: 2 }}>{price !== null ? `$${price.toFixed(3)}` : ""}</div>
            </div>
          ))}
        </div>
      </div>
      <div style={{ position: "relative", height: 120 }}>
        <canvas ref={canvasRef} width={800} height={120} style={{ width: "100%", height: "100%" }} />
        {history.length < 2 && (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontSize: 13, color: "var(--text3)" }}>Waiting for market data...</span>
          </div>
        )}
      </div>
    </div>
  );
}
