"use client";

import { useEffect, useRef, useState } from "react";
import { fetchOrderbook } from "../lib/clob";

interface Props {
  yesToken: string;
  question?: string;
  embedded?: boolean;
}

function cleanQuestion(question: string) {
  return question.split(" t=")[0].split("t=")[0].trim();
}

export default function PriceChart({ yesToken, question, embedded = false }: Props) {
  const [yesPrice, setYesPrice] = useState<number | null>(null);
  const [history, setHistory] = useState<{ t: number; p: number }[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    setHistory([]);
    setYesPrice(null);
  }, [yesToken]);

  useEffect(() => {
    const load = async () => {
      try {
        const book = await fetchOrderbook(yesToken);
        const next = book.bids[0] && book.asks[0]
          ? (book.bids[0].price + book.asks[0].price) / 2
          : book.asks[0]?.price || book.bids[0]?.price || 0.5;
        setYesPrice(next);
        setHistory((current) => [...current, { t: Date.now(), p: next }].slice(-90));
      } catch {}
    };
    load();
    const interval = window.setInterval(load, 2200);
    return () => window.clearInterval(interval);
  }, [yesToken]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || history.length < 2) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "#edf0f5";
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i += 1) {
      const y = (height / 4) * i;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    const prices = history.map((point) => point.p);
    const min = Math.max(0, Math.min(...prices) - 0.08);
    const max = Math.min(1, Math.max(...prices) + 0.08);
    const range = max - min || 0.1;
    const toX = (index: number) => (index / (history.length - 1)) * width;
    const toY = (price: number) => height - ((price - min) / range) * height;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "rgba(22,82,240,0.18)");
    gradient.addColorStop(1, "rgba(22,82,240,0)");

    ctx.beginPath();
    ctx.moveTo(toX(0), toY(prices[0]));
    prices.forEach((price, index) => {
      if (index > 0) ctx.lineTo(toX(index), toY(price));
    });
    ctx.lineTo(toX(prices.length - 1), height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(toX(0), toY(prices[0]));
    prices.forEach((price, index) => {
      if (index > 0) ctx.lineTo(toX(index), toY(price));
    });
    ctx.strokeStyle = "#1652f0";
    ctx.lineWidth = 2;
    ctx.stroke();
  }, [history]);

  const title = cleanQuestion(question || "Market");
  const noPrice = yesPrice === null ? null : 1 - yesPrice;

  const content = (
    <>
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Probability</p>
          <h2>{title}</h2>
        </div>
        <div className="metric-row">
          <span className="metric-pill">Yes {yesPrice !== null ? `${Math.round(yesPrice * 100)}c` : "--"}</span>
          <span className="metric-pill">No {noPrice !== null ? `${Math.round(noPrice * 100)}c` : "--"}</span>
        </div>
      </div>
      <div className="chart-panel-inner">
        <div className="canvas-wrap">
          <canvas ref={canvasRef} style={{ width: "100%", height: "100%" }} />
          {history.length < 2 && (
            <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>
              <span className="subtle">Waiting for orderbook data</span>
            </div>
          )}
        </div>
      </div>
    </>
  );

  if (embedded) return content;

  return (
    <div className="chart-panel">
      {content}
    </div>
  );
}
