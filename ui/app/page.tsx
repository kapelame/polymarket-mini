"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount } from "wagmi";
import Link from "next/link";
import { useRouter } from "next/navigation";
import WalletButton from "../components/WalletButton";
import { CLOB_URL } from "../lib/signing";
import { fetchOrderbook } from "../lib/clob";

type MarketStatus = "OPEN" | "SETTLED" | "ERROR";

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
  durationSeconds?: number;
  yesToken: string;
  noToken: string;
  status: MarketStatus;
  result?: "YES" | "NO";
  createdAt: number;
  marketType?: string;
  preview?: boolean;
}

interface MarketView extends Market {
  yesPrice: number;
  noPrice: number;
  volume: number;
  todayVolume: number;
  liquidity: number;
  comments: number;
}

interface TradeRow {
  trade_id?: string;
  token_id?: string;
  price?: number;
  size?: string;
  created_at?: number;
}

const TOPICS = ["All", "Live Crypto", "Politics", "Middle East", "Crypto", "Sports", "Tech", "AI", "Elections", "Finance", "Culture"];
const SORTS = ["Trending", "New", "Ending Soon", "Liquid"];

const PREVIEW_MARKETS: Market[] = [
  {
    questionId: "preview-btc-150",
    question: "When will Bitcoin hit $150k?",
    category: "Crypto",
    expiration: Math.floor(Date.now() / 1000) + 240 * 24 * 3600,
    yesToken: "0",
    noToken: "0",
    status: "OPEN",
    createdAt: Math.floor(Date.now() / 1000) - 3600,
    preview: true,
  },
  {
    questionId: "preview-fed",
    question: "Fed decision in April?",
    category: "Finance",
    expiration: Math.floor(Date.now() / 1000) + 5 * 24 * 3600,
    yesToken: "0",
    noToken: "0",
    status: "OPEN",
    createdAt: Math.floor(Date.now() / 1000) - 7200,
    preview: true,
  },
  {
    questionId: "preview-ai",
    question: "Will a frontier AI model top every benchmark by June?",
    category: "AI",
    expiration: Math.floor(Date.now() / 1000) + 68 * 24 * 3600,
    yesToken: "0",
    noToken: "0",
    status: "OPEN",
    createdAt: Math.floor(Date.now() / 1000) - 12_000,
    preview: true,
  },
];

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m21 21-4.3-4.3m1.3-5.2a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

function formatMoney(value: number) {
  if (value >= 1_000_000_000) return `$${(value / 1_000_000_000).toFixed(value >= 10_000_000_000 ? 0 : 1)}B`;
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}K`;
  return `$${value.toFixed(0)}`;
}

function formatTimeLeft(market: Market) {
  const end = market.wallExpiration || market.expiration;
  const seconds = Math.max(0, end - Math.floor(Date.now() / 1000));
  if (market.status !== "OPEN") return market.result ? `${market.result} resolved` : "Resolved";
  if (seconds === 0) return "Ending now";
  const days = Math.floor(seconds / 86400);
  if (days > 365) return `Ends in ${Math.round(days / 365)}y`;
  if (days > 30) return `Ends in ${Math.round(days / 30)}mo`;
  if (days > 0) return `Ends in ${days}d`;
  const hours = Math.floor(seconds / 3600);
  if (hours > 0) return `Ends in ${hours}h`;
  return `Ends in ${Math.max(1, Math.floor(seconds / 60))}m`;
}

function cleanQuestion(question: string) {
  return question.split(" t=")[0].split("t=")[0].trim();
}

function categoryOf(market: Market) {
  if (market.category) return market.category;
  if (market.marketType === "CUSTOM") return "News";
  if (market.question.toLowerCase().includes("btc")) return "Crypto";
  return "Markets";
}

function thumbSymbol(category: string) {
  const normalized = category.toLowerCase();
  if (normalized.includes("crypto")) return "B";
  if (normalized.includes("sport")) return "S";
  if (normalized.includes("ai")) return "AI";
  if (normalized.includes("tech")) return "T";
  if (normalized.includes("finance")) return "$";
  if (normalized.includes("politic")) return "P";
  return "M";
}

function seededPrice(market: Market, index: number) {
  if (market.status === "SETTLED") return market.result === "YES" ? 1 : 0;
  if (market.preview) return [0.1, 0.72, 0.41][index % 3];
  return 0.5;
}

async function hydrateMarkets(markets: Market[]): Promise<MarketView[]> {
  return Promise.all(
    markets.map(async (market, index) => {
      let yesPrice = seededPrice(market, index);
      if (!market.preview && market.status === "OPEN") {
        try {
          const book = await fetchOrderbook(market.yesToken);
          if (book.bids[0] && book.asks[0]) yesPrice = (book.bids[0].price + book.asks[0].price) / 2;
          else if (book.asks[0]) yesPrice = book.asks[0].price;
          else if (book.bids[0]) yesPrice = book.bids[0].price;
        } catch {}
      }
      const age = Math.max(1, Math.floor(Date.now() / 1000) - market.createdAt);
      const base = market.preview ? [18_000_000, 140_000_000, 2_600_000][index % 3] : Math.max(2500, 180_000 - age * 4);
      return {
        ...market,
        yesPrice,
        noPrice: Math.max(0.001, 1 - yesPrice),
        volume: base,
        todayVolume: base * (market.preview ? 0.27 : 0.18),
        liquidity: base * (market.preview ? 0.12 : 0.34),
        comments: market.preview ? [37, 13, 91][index % 3] : Math.max(0, Math.floor(base / 7400)),
      };
    })
  );
}

function MarketCard({ market, onPreviewClick }: { market: MarketView; onPreviewClick: () => void }) {
  const category = categoryOf(market);
  const title = cleanQuestion(market.question);
  const content = (
    <>
      <div className="market-card-body">
        <div className={`market-thumb ${category.toLowerCase()}`}>
          <span className="thumb-symbol">{thumbSymbol(category)}</span>
        </div>
        <div>
          <div className="market-meta">
            <span>{category}</span>
            <span>·</span>
            <span>{market.status === "OPEN" ? "Active" : "Resolved"}</span>
          </div>
          <h3 className="market-title">{title}</h3>
        </div>
      </div>
      <div className="market-stats">
        <div className="stat">
          <span className="stat-label">Vol.</span>
          <span className="stat-value">{formatMoney(market.volume)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Today</span>
          <span className="stat-value">{formatMoney(market.todayVolume)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Liq.</span>
          <span className="stat-value">{formatMoney(market.liquidity)}</span>
        </div>
      </div>
      <div className="prob-row">
        <div className="prob-main">
          <span className="prob-value">{Math.round(market.yesPrice * 100)}%</span>
          <span className="prob-label">{formatTimeLeft(market)} · {market.comments} comments</span>
        </div>
        <div className="buy-pair" aria-label="Outcome prices">
          <span className="trade-mini yes">Yes {Math.max(1, Math.round(market.yesPrice * 100))}c</span>
          <span className="trade-mini no">No {Math.max(1, Math.round(market.noPrice * 100))}c</span>
        </div>
      </div>
    </>
  );

  if (market.preview) {
    return (
      <button className="market-card" type="button" onClick={onPreviewClick} style={{ textAlign: "left" }}>
        {content}
      </button>
    );
  }

  return (
    <Link className="market-card" href={`/market/${market.questionId}`}>
      {content}
    </Link>
  );
}

function CreateMarketModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (market: Market) => void;
}) {
  const { address } = useAccount();
  const [mode, setMode] = useState<"btc" | "custom">("btc");
  const [duration, setDuration] = useState(60);
  const [customDuration, setCustomDuration] = useState(86400 * 7);
  const [question, setQuestion] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("Politics");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function createMarket() {
    setLoading(true);
    setError(null);
    try {
      const isBtc = mode === "btc";
      const payload = isBtc
        ? { duration }
        : { question: question.trim(), description: description.trim(), category, duration: customDuration, creator: address };
      const path = isBtc ? "/market/create/btc" : "/market/create/custom";
      const response = await fetch(`${CLOB_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok || data.error) throw new Error(data.error || "Market creation failed");
      onCreate(data);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Market creation failed");
    } finally {
      setLoading(false);
    }
  }

  const canCreate = mode === "btc" || question.trim().length >= 10;

  return (
    <div className="modal-layer" onMouseDown={onClose}>
      <div className="modal-card" onMouseDown={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <p className="eyebrow">Create</p>
            <h2>Open a prediction market</h2>
          </div>
          <button className="icon-button" type="button" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="modal-body">
          <div className="segmented">
            <button className={mode === "btc" ? "active" : ""} type="button" onClick={() => setMode("btc")}>
              BTC quick market
            </button>
            <button className={mode === "custom" ? "active" : ""} type="button" onClick={() => setMode("custom")}>
              Custom market
            </button>
          </div>

          {mode === "btc" ? (
            <div className="form-grid">
              <div>
                <p className="field-label">Expiration</p>
                <div className="duration-grid">
                  {[
                    ["1m", 60],
                    ["5m", 300],
                    ["15m", 900],
                    ["30m", 1800],
                    ["1h", 3600],
                  ].map(([label, value]) => (
                    <button
                      className={`pm-button ${duration === value ? "primary" : ""}`}
                      key={String(value)}
                      type="button"
                      onClick={() => setDuration(Number(value))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <p className="status-text">
                One-minute demo path: entry price is captured, demo liquidity is seeded, and the market auto-settles after expiration.
              </p>
            </div>
          ) : (
            <div className="form-grid">
              <div className="field">
                <label htmlFor="market-question">Question</label>
                <input id="market-question" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Will X happen by a specific date?" />
              </div>
              <div className="field">
                <label htmlFor="market-category">Category</label>
                <select id="market-category" value={category} onChange={(event) => setCategory(event.target.value)}>
                  {["Politics", "Crypto", "Sports", "Finance", "Tech", "AI", "Culture", "News"].map((item) => (
                    <option key={item}>{item}</option>
                  ))}
                </select>
              </div>
              <div>
                <p className="field-label">Expiration</p>
                <div className="duration-grid">
                  {[
                    ["1d", 86400],
                    ["7d", 604800],
                    ["30d", 2592000],
                    ["90d", 7776000],
                    ["1y", 31536000],
                  ].map(([label, value]) => (
                    <button
                      className={`pm-button ${customDuration === value ? "primary" : ""}`}
                      key={String(value)}
                      type="button"
                      onClick={() => setCustomDuration(Number(value))}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="field">
                <label htmlFor="market-description">Rules</label>
                <textarea id="market-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Resolution source and criteria" />
              </div>
            </div>
          )}

          {error && <div className="alert error">{error}</div>}
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
            <button className="pm-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="pm-button primary" type="button" disabled={!canCreate || loading} onClick={createMarket}>
              {loading ? "Creating..." : "Create market"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MarketsPage() {
  const router = useRouter();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [marketViews, setMarketViews] = useState<MarketView[]>([]);
  const [trades, setTrades] = useState<TradeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [serverDown, setServerDown] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [topic, setTopic] = useState("All");
  const [sort, setSort] = useState("Trending");
  const [query, setQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`${CLOB_URL}/market/list`);
        if (!response.ok) throw new Error("server unavailable");
        const data = (await response.json()) as Market[];
        if (!cancelled) {
          setMarkets(data);
          setServerDown(false);
        }
      } catch {
        if (!cancelled) setServerDown(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    const interval = window.setInterval(load, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const source = markets.length > 0 ? markets : PREVIEW_MARKETS;
    hydrateMarkets(source).then((views) => {
      if (!cancelled) setMarketViews(views);
    });
    return () => {
      cancelled = true;
    };
  }, [markets]);

  useEffect(() => {
    let cancelled = false;
    async function loadTrades() {
      try {
        const response = await fetch(`${CLOB_URL}/trades`);
        const data = await response.json();
        if (!cancelled && Array.isArray(data)) setTrades(data);
      } catch {}
    }
    loadTrades();
    const interval = window.setInterval(loadTrades, 6000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const result = marketViews.filter((market) => {
      const category = categoryOf(market).toLowerCase();
      const matchesTopic = topic === "All" || category.includes(topic.toLowerCase().replace("live ", "")) || market.question.toLowerCase().includes(topic.toLowerCase());
      const matchesQuery = !normalizedQuery || market.question.toLowerCase().includes(normalizedQuery) || category.includes(normalizedQuery);
      return matchesTopic && matchesQuery;
    });
    return [...result].sort((a, b) => {
      if (sort === "New") return b.createdAt - a.createdAt;
      if (sort === "Ending Soon") return (a.wallExpiration || a.expiration) - (b.wallExpiration || b.expiration);
      if (sort === "Liquid") return b.liquidity - a.liquidity;
      return b.todayVolume - a.todayVolume;
    });
  }, [marketViews, query, sort, topic]);

  const featured = filtered.slice(0, 3);
  const rest = filtered.slice(3);

  return (
    <div className="pm-shell">
      <header className="pm-header">
        <div className="pm-header-inner">
          <Link className="pm-brand" href="/">
            <span className="pm-mark">P</span>
            <span>Polymarket</span>
          </Link>
          <label className="pm-search">
            <SearchIcon />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search markets" type="search" />
          </label>
          <div className="header-actions">
            <nav className="pm-nav" aria-label="Primary">
              <Link href="/">Markets</Link>
              <Link href="/admin">Admin</Link>
            </nav>
            <button className="pm-button primary" type="button" onClick={() => setShowCreate(true)}>
              <PlusIcon />
              Create
            </button>
            <WalletButton />
          </div>
        </div>
        <div className="topic-strip">
          <div className="topic-inner">
            {TOPICS.map((item) => (
              <button key={item} className={`topic-chip ${topic === item ? "active" : ""}`} type="button" onClick={() => setTopic(item)}>
                {item}
              </button>
            ))}
          </div>
        </div>
      </header>

      <main className="pm-layout">
        <section className="pm-main">
          <div className="hero-row">
            <div>
              <p className="eyebrow">Browse</p>
              <h1 className="page-title">Explore popular predictions & real-time odds</h1>
            </div>
            <div className="chip-row">
              {SORTS.map((item) => (
                <button key={item} className={`filter-chip ${sort === item ? "active" : ""}`} type="button" onClick={() => setSort(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>

          {serverDown && (
            <div className="alert error" style={{ marginBottom: 14 }}>
              CLOB server is not reachable at {CLOB_URL}. Preview markets are shown until the local server is running.
            </div>
          )}

          {loading ? (
            <div className="empty-state">
              <div>
                <div className="empty-visual">P</div>
                <h2>Loading markets</h2>
                <p className="subtle">Reading local CLOB market data.</p>
              </div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty-state">
              <div>
                <div className="empty-visual">+</div>
                <h2>No matching markets</h2>
                <p className="subtle">Create a local market or clear your filters.</p>
                <button className="pm-button primary" type="button" onClick={() => setShowCreate(true)} style={{ marginTop: 14 }}>
                  Create market
                </button>
              </div>
            </div>
          ) : (
            <>
              <div className="featured-grid">
                {featured.map((market) => (
                  <MarketCard key={market.questionId} market={market} onPreviewClick={() => setShowCreate(true)} />
                ))}
              </div>

              {rest.length > 0 && (
                <>
                  <div className="toolbar">
                    <h2>{markets.length > 0 ? "Local markets" : "Preview markets"}</h2>
                    <span className="subtle">{markets.length > 0 ? `${markets.length} live market${markets.length === 1 ? "" : "s"}` : "Create a local market to enable trading"}</span>
                  </div>

                  <div className="market-list">
                    {rest.map((market) => (
                      <MarketCard key={`list-${market.questionId}`} market={market} onPreviewClick={() => setShowCreate(true)} />
                    ))}
                  </div>
                </>
              )}
            </>
          )}
        </section>

        <aside className="pm-aside">
          <section className="side-panel">
            <div className="panel-heading">
              <h2>Breaking</h2>
              <button className="small-link" type="button" onClick={() => setSort("New")}>
                New
              </button>
            </div>
            <div className="activity-list">
              {marketViews.slice(0, 4).map((market) => (
                <div className="activity-item" key={`activity-${market.questionId}`}>
                  <span className="activity-title">{cleanQuestion(market.question)}</span>
                  <span className="activity-meta">
                    <span>{categoryOf(market)}</span>
                    <strong>{Math.round(market.yesPrice * 100)}%</strong>
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="side-panel">
            <div className="panel-heading">
              <h2>Latest trades</h2>
              <span className="subtle">CLOB</span>
            </div>
            <div className="activity-list">
              {trades.length === 0 ? (
                <div className="activity-item">
                  <span className="activity-title">No fills yet</span>
                  <span className="activity-meta">Matched orders will appear here.</span>
                </div>
              ) : (
                trades.slice(0, 5).map((trade, index) => (
                  <div className="activity-item" key={trade.trade_id || index}>
                    <span className="activity-title">Trade at {Math.round(Number(trade.price || 0) * 100)}c</span>
                    <span className="activity-meta">
                      <span>{trade.size ? `${(Number(trade.size) / 1e6).toFixed(2)} shares` : "Fill"}</span>
                      <span>{trade.created_at ? new Date(trade.created_at * 1000).toLocaleTimeString() : "Now"}</span>
                    </span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="side-panel">
            <div className="panel-heading">
              <h2>Hot topics</h2>
              <button className="small-link" type="button" onClick={() => setTopic("All")}>
                All
              </button>
            </div>
            <div className="topic-list">
              {TOPICS.filter((item) => item !== "All").slice(0, 7).map((item, index) => (
                <button className="topic-item" key={item} type="button" onClick={() => setTopic(item)} style={{ textAlign: "left", borderLeft: 0, borderRight: 0, borderTop: 0, background: "transparent", cursor: "pointer" }}>
                  <span className="topic-title">{index + 1}. {item}</span>
                  <span className="topic-meta">
                    <span>{Math.max(1, marketViews.filter((market) => categoryOf(market).toLowerCase().includes(item.toLowerCase().replace("live ", ""))).length)} markets</span>
                    <span>{formatMoney(2_400_000 * (index + 1))} vol.</span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        </aside>
      </main>

      {showCreate && (
        <CreateMarketModal
          onClose={() => setShowCreate(false)}
          onCreate={(market) => {
            setMarkets((current) => [market, ...current]);
            router.push(`/market/${market.questionId}`);
          }}
        />
      )}
    </div>
  );
}
