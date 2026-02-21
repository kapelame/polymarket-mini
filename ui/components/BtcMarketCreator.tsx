"use client";
import { useState, useEffect, useRef } from "react";
import { useAccount } from "wagmi";

interface Market {
  questionId:    string;
  question:      string;
  btcEntryPrice: number;
  btcExitPrice?: number;
  expiration:    number;
  yesToken:      string;
  noToken:       string;
  status:        "OPEN" | "SETTLED" | "ERROR";
  result?:       "YES" | "NO";
  createdAt:     number;
}

interface BtcTick {
  price: number;
  time:  number;
}

function Countdown({ expiration }: { expiration: number }) {
  const [secs, setSecs] = useState(Math.max(0, expiration - Math.floor(Date.now() / 1000)));

  useEffect(() => {
    const id = setInterval(() => {
      setSecs(Math.max(0, expiration - Math.floor(Date.now() / 1000)));
    }, 1000);
    return () => clearInterval(id);
  }, [expiration]);

  const mins = Math.floor(secs / 60);
  const s    = secs % 60;
  const pct  = Math.max(0, secs / (expiration - Math.floor(Date.now() / 1000) + secs) * 100);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>TIME LEFT</span>
        <span className="mono" style={{
          fontSize: 13, fontWeight: 600,
          color: secs < 30 ? "var(--red)" : secs < 60 ? "var(--yellow)" : "var(--green)",
        }}>
          {secs === 0 ? "EXPIRED" : `${mins}:${String(s).padStart(2, "0")}`}
        </span>
      </div>
      <div style={{ height: 3, background: "var(--border)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 2,
          background: secs < 30 ? "var(--red)" : secs < 60 ? "var(--yellow)" : "var(--green)",
          width: `${secs / (expiration - Math.floor(Date.now()/1000) + secs) * 100}%`,
          transition: "width 1s linear, background 0.3s",
        }} />
      </div>
    </div>
  );
}

function LiveBtcPrice() {
  const [price, setPrice] = useState<number | null>(null);
  const [change, setChange] = useState<number>(0);
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    const fetch = async () => {
      try {
        const r = await window.fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        const d = await r.json();
        const p = parseFloat(d.price);
        if (prevRef.current !== null) setChange(((p - prevRef.current) / prevRef.current) * 100);
        prevRef.current = p;
        setPrice(p);
      } catch {}
    };
    fetch();
    const id = setInterval(fetch, 5000);
    return () => clearInterval(id);
  }, []);

  if (!price) return (
    <div style={{ fontSize: 12, color: "var(--text3)" }}>Loading BTC price...</div>
  );

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
      <span className="mono" style={{ fontSize: 20, fontWeight: 700, color: "var(--text)" }}>
        ${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
      </span>
      <span className="mono" style={{
        fontSize: 12, fontWeight: 600,
        color: change >= 0 ? "var(--green)" : "var(--red)",
      }}>
        {change >= 0 ? "▲" : "▼"} {Math.abs(change).toFixed(3)}%
      </span>
    </div>
  );
}

function MarketCard({ market, onTrade }: { market: Market; onTrade: (m: Market, side: "YES" | "NO") => void }) {
  const isOpen    = market.status === "OPEN";
  const isExpired = market.expiration <= Math.floor(Date.now() / 1000);

  return (
    <div style={{
      background: "var(--surface2)",
      border: `1px solid ${market.status === "SETTLED"
        ? (market.result === "YES" ? "rgba(22,199,132,0.3)" : "rgba(234,57,67,0.3)")
        : "var(--border)"}`,
      borderRadius: 10, padding: 14,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      {/* Question */}
      <div style={{ fontSize: 12, color: "var(--text2)", lineHeight: 1.4 }}>
        {market.question.split("(")[0].trim()}
      </div>

      {/* Entry price */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>ENTRY PRICE</div>
          <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--amber)" }}>
            ${market.btcEntryPrice.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </span>
        </div>
        {market.status === "SETTLED" && (
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>EXIT PRICE</div>
            <span className="mono" style={{
              fontSize: 14, fontWeight: 600,
              color: market.result === "YES" ? "var(--green)" : "var(--red)",
            }}>
              ${market.btcExitPrice?.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
          </div>
        )}
      </div>

      {/* Status */}
      {isOpen && !isExpired && (
        <Countdown expiration={market.expiration} />
      )}

      {market.status === "SETTLED" && (
        <div style={{
          display: "flex", alignItems: "center", gap: 6,
          padding: "8px 12px", borderRadius: 8,
          background: market.result === "YES" ? "var(--green-bg)" : "var(--red-bg)",
        }}>
          <span style={{ fontSize: 16 }}>{market.result === "YES" ? "📈" : "📉"}</span>
          <div>
            <div style={{
              fontSize: 12, fontWeight: 700,
              color: market.result === "YES" ? "var(--green)" : "var(--red)",
            }}>
              {market.result} WINS
            </div>
            <div style={{ fontSize: 11, color: "var(--text3)" }}>
              BTC {market.result === "YES" ? "rose" : "fell"}
            </div>
          </div>
        </div>
      )}

      {/* Trade buttons */}
      {isOpen && !isExpired && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <button onClick={() => onTrade(market, "YES")}
            className="btn"
            style={{
              padding: "9px 0", fontSize: 12, fontWeight: 700, borderRadius: 7,
              background: "var(--green-bg)", color: "var(--green)",
              border: "1px solid rgba(22,199,132,0.3)",
            }}>
            📈 BUY YES
          </button>
          <button onClick={() => onTrade(market, "NO")}
            className="btn"
            style={{
              padding: "9px 0", fontSize: 12, fontWeight: 700, borderRadius: 7,
              background: "var(--red-bg)", color: "var(--red)",
              border: "1px solid rgba(234,57,67,0.3)",
            }}>
            📉 BUY NO
          </button>
        </div>
      )}

      {isExpired && market.status !== "SETTLED" && (
        <div style={{ fontSize: 12, color: "var(--text3)", textAlign: "center" }}>
          ⏳ Awaiting resolution...
        </div>
      )}
    </div>
  );
}

export default function BtcMarketCreator({ onMarketCreated }: {
  onMarketCreated?: (yesToken: string, noToken: string) => void
}) {
  const { address } = useAccount();
  const [markets,  setMarkets]  = useState<Market[]>([]);
  const [creating, setCreating] = useState(false);
  const [duration, setDuration] = useState(300);
  const [status,   setStatus]   = useState<string | null>(null);
  const [expanded, setExpanded] = useState(true);

  // Poll market list
  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("http://localhost:3000/market/list");
        const d = await r.json();
        setMarkets(d);
      } catch {}
    };
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, []);

  async function createMarket() {
    if (!address) { setStatus("Connect wallet first"); return; }
    setCreating(true);
    setStatus("Creating market on-chain...");
    try {
      const r = await fetch("http://localhost:3000/market/create/btc", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ duration }),
      });
      const market = await r.json();
      if (market.error) throw new Error(market.error);

      setStatus(`✓ Market created! Trade opens now`);
      setMarkets(prev => [market, ...prev]);

      if (onMarketCreated) onMarketCreated(market.yesToken, market.noToken);
    } catch (e: any) {
      setStatus(`✗ ${e.message}`);
    }
    setCreating(false);
  }

  function handleTrade(market: Market, side: "YES" | "NO") {
    if (onMarketCreated) {
      const token = side === "YES" ? market.yesToken : market.noToken;
      onMarketCreated(market.yesToken, market.noToken);
    }
  }

  const durations = [
    { label: "1 min",  value: 60   },
    { label: "5 min",  value: 300  },
    { label: "15 min", value: 900  },
    { label: "1 hr",   value: 3600 },
  ];

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Header */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{
          padding: "14px 16px",
          borderBottom: expanded ? "1px solid var(--border)" : "none",
          display: "flex", alignItems: "center", justifyContent: "space-between",
          cursor: "pointer",
        }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 16 }}>₿</span>
          <span style={{ fontWeight: 600, fontSize: 13 }}>BTC Price Markets</span>
          {markets.filter(m => m.status === "OPEN").length > 0 && (
            <div style={{
              background: "var(--green)", color: "black",
              fontSize: 10, fontWeight: 700,
              padding: "1px 6px", borderRadius: 10,
            }}>
              {markets.filter(m => m.status === "OPEN").length} LIVE
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <LiveBtcPrice />
          <span style={{ color: "var(--text3)", fontSize: 12 }}>{expanded ? "▲" : "▼"}</span>
        </div>
      </div>

      {expanded && (
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 14 }}>
          {/* Create market */}
          <div style={{
            background: "var(--surface2)", borderRadius: 10, padding: 14,
            border: "1px solid var(--border)",
          }}>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 10 }}>
              Create New Market
            </div>

            {/* Duration */}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 6 }}>
                DURATION
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 4 }}>
                {durations.map(d => (
                  <button key={d.value} onClick={() => setDuration(d.value)}
                    className="btn"
                    style={{
                      padding: "7px 0", fontSize: 11, fontWeight: 600, borderRadius: 6,
                      background: duration === d.value ? "var(--amber)" : "var(--surface)",
                      color: duration === d.value ? "black" : "var(--text2)",
                      border: "1px solid var(--border)",
                    }}>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 10 }}>
              Will BTC be higher than <strong style={{ color: "var(--amber)" }}>current price</strong> in {
                duration < 60 ? `${duration}s` :
                duration < 3600 ? `${duration/60}m` : `${duration/3600}h`
              }?
            </div>

            <button onClick={createMarket} disabled={creating || !address} className="btn"
              style={{
                width: "100%", padding: "10px 0", fontSize: 13, fontWeight: 600, borderRadius: 8,
                background: creating ? "var(--surface)" : "linear-gradient(135deg, #f59e0b, #ef4444)",
                color: creating ? "var(--text3)" : "white",
              }}>
              {creating ? "Creating..." : "🚀 Launch Market"}
            </button>

            {!address && (
              <div style={{ fontSize: 11, color: "var(--text3)", textAlign: "center", marginTop: 8 }}>
                Connect wallet to create markets
              </div>
            )}

            {status && (
              <div style={{
                marginTop: 10, padding: "8px 10px", borderRadius: 7,
                background: status.startsWith("✓") ? "var(--green-bg)" : "rgba(234,57,67,0.1)",
                fontSize: 12,
                color: status.startsWith("✓") ? "var(--green)" : status.startsWith("✗") ? "var(--red)" : "var(--amber)",
              }}>{status}</div>
            )}
          </div>

          {/* Market list */}
          {markets.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ fontSize: 11, color: "var(--text3)", fontWeight: 500 }}>
                ACTIVE MARKETS ({markets.length})
              </div>
              {markets.map(m => (
                <MarketCard key={m.questionId} market={m} onTrade={handleTrade} />
              ))}
            </div>
          )}

          {markets.length === 0 && (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📊</div>
              <div style={{ fontSize: 12, color: "var(--text3)" }}>
                No markets yet. Create the first one!
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
