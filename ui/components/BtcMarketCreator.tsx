"use client";
import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";

interface Market {
  questionId: string; question: string; btcEntryPrice: number;
  btcExitPrice?: number; expiration: number; yesToken: string; noToken: string;
  status: "OPEN"|"SETTLED"|"ERROR"; result?: "YES"|"NO"; wallExpiration?: number; createdAt: number;
}

function Countdown({ expiration }: { expiration: number }) {
  const [secs, setSecs] = useState(() => Math.max(0, expiration - Math.floor(Date.now()/1000)));
  useEffect(() => { const id = setInterval(() => setSecs(Math.max(0, expiration - Math.floor(Date.now()/1000))), 1000); return () => clearInterval(id); }, [expiration]);
  const color = secs === 0 ? "var(--text3)" : secs < 30 ? "var(--red)" : secs < 60 ? "var(--yellow)" : "var(--green)";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>TIME LEFT</span>
        <span className="mono" style={{ fontSize: 13, fontWeight: 600, color }}>{secs === 0 ? "EXPIRED" : `${Math.floor(secs/60)}:${String(secs%60).padStart(2,"0")}`}</span>
      </div>
      <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ height: "100%", borderRadius: 2, background: color, transition: "width 1s linear" }} />
      </div>
    </div>
  );
}

function LiveBtcPrice() {
  const [price, setPrice]   = useState<number|null>(null);
  const [change, setChange] = useState(0);
  const prev = useRef<number|null>(null);
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        const d = await r.json();
        const p = parseFloat(d.price);
        if (prev.current !== null) setChange(((p - prev.current) / prev.current) * 100);
        prev.current = p; setPrice(p);
      } catch {}
    };
    load(); const id = setInterval(load, 5000); return () => clearInterval(id);
  }, []);
  if (!price) return <span style={{ fontSize: 12, color: "var(--text3)" }}>Loading...</span>;
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
      <span className="mono" style={{ fontSize: 16, fontWeight: 700 }}>${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      <span className="mono" style={{ fontSize: 11, fontWeight: 600, color: change >= 0 ? "var(--green)" : "var(--red)" }}>{change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(3)}%</span>
    </div>
  );
}

function MarketCard({ market, isActive, onSelect, onTrade }: { market: Market; isActive: boolean; onSelect: (m: Market) => void; onTrade: (m: Market, side: "YES"|"NO") => void }) {
  const isOpen = market.status === "OPEN";
  const isExpired = (market.wallExpiration || market.expiration) <= Math.floor(Date.now()/1000);
  const shortQ = market.question.split("(")[0].split("t=")[0].trim();
  return (
    <div onClick={() => onSelect(market)} style={{ background: isActive ? "var(--surface)" : "var(--surface2)", border: `1px solid ${isActive ? "var(--blue)" : market.status === "SETTLED" ? (market.result === "YES" ? "rgba(22,199,132,0.3)" : "rgba(234,57,67,0.3)") : "var(--border)"}`, borderRadius: 10, padding: 14, display: "flex", flexDirection: "column", gap: 10, cursor: "pointer" }}>
      <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.4, fontWeight: isActive ? 600 : 400 }}>{shortQ}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>ENTRY</div>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: "var(--amber)" }}>${market.btcEntryPrice.toLocaleString("en-US", { minimumFractionDigits: 0 })}</span>
        </div>
        {market.status === "SETTLED" && <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>EXIT</div>
          <span className="mono" style={{ fontSize: 13, fontWeight: 600, color: market.result === "YES" ? "var(--green)" : "var(--red)" }}>${market.btcExitPrice?.toLocaleString("en-US", { minimumFractionDigits: 0 })}</span>
        </div>}
        <div style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 6, background: market.status === "OPEN" ? "var(--green-bg)" : market.status === "SETTLED" ? "var(--surface2)" : "rgba(234,57,67,0.1)", color: market.status === "OPEN" ? "var(--green)" : market.status === "SETTLED" ? "var(--text3)" : "var(--red)" }}>{market.status === "OPEN" ? "LIVE" : market.status}</div>
      </div>
      {isOpen && !isExpired && <Countdown expiration={market.wallExpiration || market.expiration} />}
      {market.status === "SETTLED" && <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", borderRadius: 8, background: market.result === "YES" ? "var(--green-bg)" : "var(--red-bg)" }}><span style={{ fontSize: 14 }}>{market.result === "YES" ? "📈" : "📉"}</span><span style={{ fontSize: 12, fontWeight: 700, color: market.result === "YES" ? "var(--green)" : "var(--red)" }}>{market.result} WINS — BTC {market.result === "YES" ? "rose" : "fell"}</span></div>}
      {isOpen && !isExpired && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <button onClick={e => { e.stopPropagation(); onTrade(market, "YES"); }} className="btn" style={{ padding: "8px 0", fontSize: 12, fontWeight: 700, borderRadius: 7, background: "var(--green-bg)", color: "var(--green)", border: "1px solid rgba(22,199,132,0.3)" }}>📈 YES</button>
          <button onClick={e => { e.stopPropagation(); onTrade(market, "NO"); }} className="btn" style={{ padding: "8px 0", fontSize: 12, fontWeight: 700, borderRadius: 7, background: "var(--red-bg)", color: "var(--red)", border: "1px solid rgba(234,57,67,0.3)" }}>📉 NO</button>
        </div>
      )}
      {isExpired && market.status === "OPEN" && <div style={{ fontSize: 12, color: "var(--text3)", textAlign: "center" }}>⏳ Awaiting resolution...</div>}
    </div>
  );
}

export default function BtcMarketCreator({ onMarketCreated }: { onMarketCreated?: (yesToken: string, noToken: string, question: string, questionId: string) => void }) {
  const { address } = useAccount();
  const [markets,  setMarkets]  = useState<Market[]>([]);
  const [creating, setCreating] = useState(false);
  const [duration, setDuration] = useState(300);
  const [status,   setStatus]   = useState<string|null>(null);
  const [expanded, setExpanded] = useState(true);
  const [activeQid,setActiveQid]= useState<string|null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("http://localhost:3000/market/list");
        const d: Market[] = await r.json();
        setMarkets(d);
        if (!activeQid && d.length > 0) {
          const first = d.find(m => m.status === "OPEN") || d[0];
          setActiveQid(first.questionId);
          onMarketCreated?.(first.yesToken, first.noToken, first.question, first.questionId);
        }
      } catch {}
    };
    load(); const id = setInterval(load, 5000); return () => clearInterval(id);
  }, []);

  async function createMarket() {
    if (!address) { setStatus("Connect wallet first"); return; }
    setCreating(true); setStatus("Creating market on-chain...");
    try {
      const r = await fetch("http://localhost:3000/market/create/btc", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duration }) });
      const market: Market = await r.json();
      if ((market as any).error) throw new Error((market as any).error);
      setMarkets(prev => [market, ...prev]);
      setActiveQid(market.questionId);
      setStatus("✓ Market created!");
      onMarketCreated?.(market.yesToken, market.noToken, market.question, market.questionId);
    } catch (e: any) { setStatus(`✗ ${e.message}`); }
    setCreating(false);
  }

  function handleSelect(market: Market) {
    setActiveQid(market.questionId);
    onMarketCreated?.(market.yesToken, market.noToken, market.question, market.questionId);
  }

  const durations = [{ label:"1m", value:60 }, { label:"5m", value:300 }, { label:"15m", value:900 }, { label:"1h", value:3600 }];

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      <div onClick={() => setExpanded(e => !e)} style={{ padding: "14px 16px", borderBottom: expanded ? "1px solid var(--border)" : "none", display: "flex", alignItems: "center", justifyContent: "space-between", cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>₿</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>BTC Markets</span>
          {markets.filter(m => m.status === "OPEN").length > 0 && <div style={{ background: "var(--green)", color: "black", fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 10 }}>{markets.filter(m => m.status === "OPEN").length} LIVE</div>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <LiveBtcPrice />
          <span style={{ color: "var(--text3)", fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>
      {expanded && (
        <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "var(--surface2)", borderRadius: 10, padding: 12, border: "1px solid var(--border)" }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>New Market</div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 4, marginBottom: 10 }}>
              {durations.map(d => <button key={d.value} onClick={() => setDuration(d.value)} className="btn" style={{ padding: "6px 0", fontSize: 11, fontWeight: 600, borderRadius: 6, background: duration === d.value ? "var(--amber)" : "var(--surface)", color: duration === d.value ? "black" : "var(--text2)", border: "1px solid var(--border)" }}>{d.label}</button>)}
            </div>
            <button onClick={createMarket} disabled={creating || !address} className="btn" style={{ width: "100%", padding: "9px 0", fontSize: 13, fontWeight: 600, borderRadius: 8, background: creating ? "var(--surface)" : "linear-gradient(135deg,#f59e0b,#ef4444)", color: creating ? "var(--text3)" : "white" }}>{creating ? "Creating..." : "🚀 Launch Market"}</button>
            {status && <div style={{ marginTop: 8, padding: "7px 10px", borderRadius: 7, fontSize: 12, background: status.startsWith("✓") ? "var(--green-bg)" : "rgba(234,57,67,0.1)", color: status.startsWith("✓") ? "var(--green)" : status.startsWith("✗") ? "var(--red)" : "var(--amber)" }}>{status}</div>}
          </div>
          {markets.length > 0 ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 500 }}>MARKETS ({markets.length})</div>
              {markets.map(m => <MarketCard key={m.questionId} market={m} isActive={m.questionId === activeQid} onSelect={handleSelect} onTrade={handleSelect} />)}
            </div>
          ) : (
            <div style={{ textAlign: "center", padding: "12px 0" }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📊</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>No markets yet</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
