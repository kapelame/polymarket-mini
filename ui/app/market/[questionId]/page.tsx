"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import { ConnectButton } from "@rainbow-me/rainbowkit";

const CandleChart  = dynamic(() => import("../../../components/CandleChart"),  { ssr: false });
const PriceChart   = dynamic(() => import("../../../components/PriceChart"),   { ssr: false });
const OrderBook    = dynamic(() => import("../../../components/OrderBook"),    { ssr: false });
const OrderForm    = dynamic(() => import("../../../components/OrderForm"),    { ssr: false });
const LivePriceChart = dynamic(() => import('../../../components/LivePriceChart'), { ssr: false });
const TradeHistory = dynamic(() => import("../../../components/TradeHistory"), { ssr: false });

interface Market {
  questionId: string; question: string; btcEntryPrice: number;
  btcExitPrice?: number; expiration: number; yesToken: string; noToken: string;
  status: "OPEN"|"SETTLED"|"ERROR"; result?: "YES"|"NO"; wallExpiration?: number; createdAt: number; wallExpiration?: number;
}

export default function MarketPage() {
  const { questionId } = useParams<{ questionId: string }>();
  const [market, setMarket] = useState<Market | null>(null);
  const [tab,    setTab]    = useState<"chart"|"book"|"trades">("chart");
  const [error,  setError]  = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`http://localhost:3000/market/${questionId}`);
        if (!r.ok) { setError(true); return; }
        setMarket(await r.json());
      } catch { setError(true); }
    };
    load(); const id = setInterval(load, 5000); return () => clearInterval(id);
  }, [questionId]);

  const shortQ = market ? market.question.split("(")[0].split("t=")[0].trim() : "";

  if (error) return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12 }}>
      <div style={{ fontSize: 48 }}>🔍</div>
      <div style={{ fontSize: 18, fontWeight: 600 }}>Market not found</div>
      <Link href="/" style={{ color: "var(--blue,#3b82f6)", fontSize: 14 }}>← Back to markets</Link>
    </div>
  );

  if (!market) return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ fontSize: 14, color: "var(--text3)" }}>Loading...</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>
      {/* Header */}
      <header style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "0 20px", height: 52, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/" style={{ color: "var(--text3)", fontSize: 13, textDecoration: "none", display: "flex", alignItems: "center", gap: 4 }}>
            ← Markets
          </Link>
          <div style={{ width: 1, height: 16, background: "var(--border)" }} />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 7, height: 7, borderRadius: "50%", background: market.status === "OPEN" ? "var(--green)" : "var(--text3)", boxShadow: market.status === "OPEN" ? "0 0 6px var(--green)" : "none" }} />
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", maxWidth: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortQ}</span>
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
            background: market.status === "OPEN" ? "var(--green-bg)" : "var(--surface2)",
            color: market.status === "OPEN" ? "var(--green)" : "var(--text3)" }}>
            {market.status}
          </div>
        </div>
        <ConnectButton chainStatus="none" showBalance={false} label="Connect" />
      </header>

      {/* Layout: main + sidebar */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden", height: "calc(100vh - 52px)" }}>

        {/* Main */}
        <div style={{ flex: 1, overflowY: "auto", padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>

          {/* Market info bar */}
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {[
              { label: "ENTRY PRICE", value: `$${market.btcEntryPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, color: "var(--amber,#f59e0b)" },
              ...(market.btcExitPrice ? [{ label: "EXIT PRICE", value: `$${market.btcExitPrice.toLocaleString("en-US", { maximumFractionDigits: 2 })}`, color: market.result === "YES" ? "var(--green)" : "var(--red)" }] : []),
              ...(market.result ? [{ label: "RESULT", value: `${market.result} WINS`, color: market.result === "YES" ? "var(--green)" : "var(--red)" }] : []),
            ].map(({ label, value, color }) => (
              <div key={label} style={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 14px" }}>
                <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 3 }}>{label}</div>
                <div className="mono" style={{ fontSize: 15, fontWeight: 700, color }}>{value}</div>
              </div>
            ))}
          </div>

          {/* Live real-time price tracker */}
          <LivePriceChart entryPrice={market.btcEntryPrice} expiration={market.wallExpiration || market.expiration} marketResult={market.result} />

          {/* BTC Candle chart */}
          <CandleChart entryPrice={market.btcEntryPrice} marketResult={market.result} height={280} />

          {/* Tabs */}
          <div style={{ display: "flex", gap: 0, borderBottom: "1px solid var(--border)" }}>
            {(["chart","book","trades"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)}
                style={{
                  padding: "8px 18px", fontSize: 13, fontWeight: tab === t ? 600 : 400,
                  color: tab === t ? "var(--text)" : "var(--text3)",
                  background: "none", border: "none", borderBottom: tab === t ? "2px solid var(--blue,#3b82f6)" : "2px solid transparent",
                  cursor: "pointer", textTransform: "capitalize", marginBottom: -1,
                }}>{t === "book" ? "Order Book" : t === "trades" ? "Trade History" : "YES Price"}</button>
            ))}
          </div>

          <div style={{ flex: 1 }}>
            {tab === "chart"  && <PriceChart yesToken={market.yesToken} question={market.question} />}
            {tab === "book"   && <OrderBook  yesToken={market.yesToken} />}
            {tab === "trades" && <TradeHistory yesToken={market.yesToken} />}
          </div>
        </div>

        {/* Sidebar */}
        <div style={{ width: 320, borderLeft: "1px solid var(--border)", overflowY: "auto", padding: 16, background: "var(--surface)", flexShrink: 0 }}>
          <OrderForm yesToken={market.yesToken} noToken={market.noToken} question={market.question} />
        </div>
      </div>
    </div>
  );
}
