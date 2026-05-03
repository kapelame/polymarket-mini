"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";
import WalletButton from "../../../components/WalletButton";
import { CLOB_URL } from "../../../lib/signing";
import { fetchOrderbook } from "../../../lib/clob";

const PriceChart = dynamic(() => import("../../../components/PriceChart"), { ssr: false });
const CandleChart = dynamic(() => import("../../../components/CandleChart"), { ssr: false });
const OrderBook = dynamic(() => import("../../../components/OrderBook"), { ssr: false });
const OrderForm = dynamic(() => import("../../../components/OrderForm"), { ssr: false });
const TradeHistory = dynamic(() => import("../../../components/TradeHistory"), { ssr: false });

interface Market {
  questionId: string;
  conditionId?: string;
  question: string;
  description?: string;
  category?: string;
  btcEntryPrice?: number;
  btcExitPrice?: number;
  expiration: number;
  wallExpiration?: number;
  yesToken: string;
  noToken: string;
  status: "OPEN" | "SETTLED" | "ERROR";
  result?: "YES" | "NO";
  createdAt: number;
  marketType?: string;
}

function cleanQuestion(question: string) {
  return question.split(" t=")[0].split("t=")[0].trim();
}

function categoryOf(market: Market) {
  if (market.category) return market.category;
  if (market.question.toLowerCase().includes("btc")) return "Crypto";
  return "Markets";
}

function thumbSymbol(category: string) {
  const normalized = category.toLowerCase();
  if (normalized.includes("crypto")) return "B";
  if (normalized.includes("sport")) return "S";
  if (normalized.includes("ai")) return "AI";
  if (normalized.includes("finance")) return "$";
  if (normalized.includes("politic")) return "P";
  return "M";
}

function formatMoney(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatTimeLeft(market: Market) {
  if (market.status !== "OPEN") return market.result ? `${market.result} resolved` : "Resolved";
  const end = market.wallExpiration || market.expiration;
  const seconds = Math.max(0, end - Math.floor(Date.now() / 1000));
  if (seconds === 0) return "Ending now";
  const days = Math.floor(seconds / 86400);
  if (days > 0) return `Ends in ${days}d`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `Ends in ${hours}h`;
  return `Ends in ${Math.max(1, Math.floor(seconds / 60))}m`;
}

function Header() {
  return (
    <header className="pm-header">
      <div className="pm-header-inner">
        <Link className="pm-brand" href="/">
          <span className="pm-mark">P</span>
          <span>Polymarket</span>
        </Link>
        <div className="pm-search" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="m21 21-4.3-4.3m1.3-5.2a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
          </svg>
          <span className="subtle">Search markets</span>
        </div>
        <div className="header-actions">
          <nav className="pm-nav" aria-label="Primary">
            <Link href="/">Markets</Link>
            <Link href="/admin">Admin</Link>
          </nav>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}

export default function MarketPage() {
  const { questionId } = useParams<{ questionId: string }>();
  const [market, setMarket] = useState<Market | null>(null);
  const [tab, setTab] = useState<"chart" | "book" | "trades">("chart");
  const [outcome, setOutcome] = useState<"YES" | "NO">("YES");
  const [yesPrice, setYesPrice] = useState(0.5);
  const [noPrice, setNoPrice] = useState(0.5);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`${CLOB_URL}/market/${questionId}`);
        if (!response.ok) throw new Error("not found");
        const data = (await response.json()) as Market;
        if (!cancelled) {
          setMarket(data);
          setError(false);
        }
      } catch {
        if (!cancelled) setError(true);
      }
    }
    load();
    const interval = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [questionId]);

  useEffect(() => {
    if (!market) return;
    const currentMarket = market;
    let cancelled = false;
    async function loadPrices() {
      if (currentMarket.status !== "OPEN" && currentMarket.result) {
        const settledYes = currentMarket.result === "YES" ? 1 : 0;
        if (!cancelled) {
          setYesPrice(settledYes);
          setNoPrice(1 - settledYes);
        }
        return;
      }
      try {
        const book = await fetchOrderbook(currentMarket.yesToken);
        const next = book.bids[0] && book.asks[0]
          ? (book.bids[0].price + book.asks[0].price) / 2
          : book.asks[0]?.price || book.bids[0]?.price || (currentMarket.result === "YES" ? 1 : currentMarket.result === "NO" ? 0 : 0.5);
        if (!cancelled) {
          setYesPrice(next);
          setNoPrice(Math.max(0, 1 - next));
        }
      } catch {}
    }
    loadPrices();
    const interval = window.setInterval(loadPrices, 2400);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [market]);

  const stats = useMemo(() => {
    if (!market) return { volume: 0, liquidity: 0, comments: 0 };
    const age = Math.max(1, Math.floor(Date.now() / 1000) - market.createdAt);
    const base = Math.max(2500, 220_000 - age * 5);
    return { volume: base, liquidity: base * 0.32, comments: Math.floor(base / 8200) };
  }, [market]);

  if (error) {
    return (
      <div className="pm-shell">
        <Header />
        <main className="empty-state" style={{ margin: "50px auto", maxWidth: 620 }}>
          <div>
            <div className="empty-visual">?</div>
            <h2>Market not found</h2>
            <p className="subtle">The local CLOB server does not have this market loaded.</p>
            <Link className="pm-button primary" href="/" style={{ marginTop: 14 }}>Back to markets</Link>
          </div>
        </main>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="pm-shell">
        <Header />
        <main className="empty-state" style={{ margin: "50px auto", maxWidth: 620 }}>
          <div>
            <div className="empty-visual">P</div>
            <h2>Loading market</h2>
            <p className="subtle">Reading market details from the local server.</p>
          </div>
        </main>
      </div>
    );
  }

  const category = categoryOf(market);
  const activeToken = outcome === "YES" ? market.yesToken : market.noToken;
  const title = cleanQuestion(market.question);

  return (
    <div className="pm-shell">
      <Header />

      <main className="detail-layout">
        <section className="detail-main">
          <Link className="back-link" href="/">
            <span aria-hidden="true">←</span>
            Markets
          </Link>

          <section className="event-header">
            <div className={`market-thumb ${category.toLowerCase()}`}>
              <span className="thumb-symbol">{thumbSymbol(category)}</span>
            </div>
            <div>
              <div className="market-meta">
                <span>{category}</span>
                <span>·</span>
                <span>{market.status}</span>
                <span>·</span>
                <span>{formatTimeLeft(market)}</span>
              </div>
              <h1 className="event-title">{title}</h1>
              <div className="metric-row">
                <span className="metric-pill">{formatMoney(stats.volume)} Vol.</span>
                <span className="metric-pill">{formatMoney(stats.liquidity)} Liq.</span>
                <span className="metric-pill">{stats.comments} comments</span>
                {market.btcEntryPrice && <span className="metric-pill">Entry ${market.btcEntryPrice.toLocaleString()}</span>}
                {market.btcExitPrice && <span className="metric-pill">Exit ${market.btcExitPrice.toLocaleString()}</span>}
              </div>
            </div>
          </section>

          <div className="probability-panel">
            <button className="outcome-card yes" type="button" onClick={() => setOutcome("YES")}>
              <div>
                <p className="eyebrow">Yes</p>
                <span className="subtle">Buy Yes {Math.round(yesPrice * 100)}c</span>
              </div>
              <strong>{Math.round(yesPrice * 100)}%</strong>
            </button>
            <button className="outcome-card no" type="button" onClick={() => setOutcome("NO")}>
              <div>
                <p className="eyebrow">No</p>
                <span className="subtle">Buy No {Math.round(noPrice * 100)}c</span>
              </div>
              <strong>{Math.round(noPrice * 100)}%</strong>
            </button>
          </div>

          <section className="chart-panel">
            <div className="tabbar">
              {[
                ["chart", "Chart"],
                ["book", "Order book"],
                ["trades", "Trades"],
              ].map(([key, label]) => (
                <button key={key} className={tab === key ? "active" : ""} type="button" onClick={() => setTab(key as "chart" | "book" | "trades")}>
                  {label}
                </button>
              ))}
              <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", paddingRight: 8 }}>
                <div className="segmented" style={{ width: 144, padding: 3 }}>
                  {(["YES", "NO"] as const).map((item) => (
                    <button key={item} className={outcome === item ? "active" : ""} type="button" onClick={() => setOutcome(item)}>
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ padding: tab === "chart" ? 0 : 14 }}>
              {tab === "chart" && (
                market.btcEntryPrice
                  ? <CandleChart entryPrice={market.btcEntryPrice} marketResult={market.result || null} embedded />
                  : <PriceChart yesToken={market.yesToken} question={market.question} embedded />
              )}
              {tab === "book" && <OrderBook tokenId={activeToken} label={outcome} />}
              {tab === "trades" && <TradeHistory yesToken={market.yesToken} />}
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <h2>Rules</h2>
              <span className="subtle">Resolution</span>
            </div>
            <div style={{ padding: 16, color: "var(--text2)", lineHeight: 1.6 }}>
              {market.description || "This local market resolves according to the market creator's criteria. BTC quick markets resolve automatically against the captured BTC entry price."}
            </div>
          </section>
        </section>

        <aside className="detail-rail">
          <OrderForm yesToken={market.yesToken} noToken={market.noToken} question={market.question} />
        </aside>
      </main>
    </div>
  );
}
