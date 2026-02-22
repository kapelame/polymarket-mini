"use client";
import { useEffect, useState, useRef } from "react";
import { useAccount } from "wagmi";
import Link from "next/link";
import { ConnectButton } from "@rainbow-me/rainbowkit";

interface Market {
  questionId: string; question: string; btcEntryPrice: number;
  btcExitPrice?: number; expiration: number; yesToken: string; noToken: string;
  status: "OPEN"|"SETTLED"|"ERROR"; result?: "YES"|"NO"; wallExpiration?: number; createdAt: number; wallExpiration?: number;
}

function Countdown({ expiration }: { expiration: number }) {
  const [secs, setSecs] = useState(() => Math.max(0, expiration - Math.floor(Date.now()/1000)));
  useEffect(() => {
    const id = setInterval(() => setSecs(Math.max(0, expiration - Math.floor(Date.now()/1000))), 1000);
    return () => clearInterval(id);
  }, [expiration]);
  const m = Math.floor(secs/60), s = secs%60;
  const color = secs === 0 ? "var(--text3)" : secs < 30 ? "var(--red)" : secs < 60 ? "var(--yellow,#f59e0b)" : "var(--green)";
  return <span className="mono" style={{ fontSize: 12, color }}>{secs === 0 ? "EXPIRED" : `${m}:${String(s).padStart(2,"0")}`}</span>;
}

function MarketCard({ market, onDelete }: { market: Market; onDelete: (id: string) => void }) {
  const isOpen = market.status === "OPEN";
  const isExpired = (market.wallExpiration || market.expiration) <= Math.floor(Date.now()/1000);
  const shortQ = market.question.split("(")[0].split("t=")[0].trim();

  return (
    <div style={{
      background: "var(--surface)",
      border: `1px solid ${market.status === "SETTLED" ? (market.result === "YES" ? "rgba(22,199,132,0.25)" : "rgba(234,57,67,0.25)") : "var(--border)"}`,
      borderRadius: 12, overflow: "hidden",
      transition: "border-color 0.2s, transform 0.1s",
    }}
    onMouseEnter={e => (e.currentTarget.style.borderColor = "var(--border2,#3a3b40)")}
    onMouseLeave={e => (e.currentTarget.style.borderColor = market.status === "SETTLED" ? (market.result === "YES" ? "rgba(22,199,132,0.25)" : "rgba(234,57,67,0.25)") : "var(--border)")}>
      
      {/* Card body — clickable */}
      <Link href={`/market/${market.questionId}`} style={{ textDecoration: "none", color: "inherit", display: "block", padding: 16 }}>
        {/* Status badge */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, padding: "2px 7px", borderRadius: 5,
              background: isOpen ? "var(--green-bg)" : market.status === "SETTLED" ? "var(--surface2)" : "rgba(234,57,67,0.1)",
              color: isOpen ? "var(--green)" : market.status === "SETTLED" ? "var(--text3)" : "var(--red)",
            }}>{isOpen ? (isExpired ? "RESOLVING" : "LIVE") : market.status}</span>
            <span style={{ fontSize: 10, color: "var(--text3)", padding: "2px 7px" }}>Crypto</span>
          </div>
          {isOpen && !isExpired && <Countdown expiration={market.wallExpiration || market.expiration} />}
        </div>

        {/* Question */}
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", lineHeight: 1.4, marginBottom: 12 }}>
          {shortQ}
        </div>

        {/* Prices */}
        <div style={{ display: "flex", gap: 12, marginBottom: 10 }}>
          <div>
            <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>ENTRY</div>
            <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: "var(--amber,#f59e0b)" }}>
              ${market.btcEntryPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
          </div>
          {market.btcExitPrice && (
            <div>
              <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2 }}>EXIT</div>
              <span className="mono" style={{ fontSize: 14, fontWeight: 600, color: market.result === "YES" ? "var(--green)" : "var(--red)" }}>
                ${market.btcExitPrice.toLocaleString("en-US", { maximumFractionDigits: 0 })}
              </span>
            </div>
          )}
        </div>

        {/* Result banner */}
        {market.status === "SETTLED" && (
          <div style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 10px", borderRadius: 8,
            background: market.result === "YES" ? "var(--green-bg)" : "var(--red-bg)",
          }}>
            <span>{market.result === "YES" ? "📈" : "📉"}</span>
            <span style={{ fontSize: 12, fontWeight: 700, color: market.result === "YES" ? "var(--green)" : "var(--red)" }}>
              {market.result} WINS — BTC {market.result === "YES" ? "rose above" : "fell below"} entry
            </span>
          </div>
        )}
      </Link>

      {/* Footer — actions */}
      <div style={{
        borderTop: "1px solid var(--border)", padding: "8px 16px",
        display: "flex", justifyContent: "space-between", alignItems: "center",
        background: "var(--surface2)",
      }}>
        <Link href={`/market/${market.questionId}`}
          style={{
            fontSize: 12, fontWeight: 600, padding: "5px 14px", borderRadius: 6,
            background: isOpen && !isExpired ? "var(--green)" : "var(--surface)",
            color: isOpen && !isExpired ? "black" : "var(--text2)",
            textDecoration: "none",
          }}>
          {isOpen && !isExpired ? "Trade →" : "View →"}
        </Link>
        <button
          onClick={() => onDelete(market.questionId)}
          style={{
            fontSize: 11, color: "var(--text3)", background: "none",
            border: "1px solid var(--border)", borderRadius: 6, padding: "4px 10px",
            cursor: "pointer", transition: "color 0.15s, border-color 0.15s",
          }}
          onMouseEnter={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--red)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--red)"; }}
          onMouseLeave={e => { (e.currentTarget as HTMLButtonElement).style.color = "var(--text3)"; (e.currentTarget as HTMLButtonElement).style.borderColor = "var(--border)"; }}>
          Delete
        </button>
      </div>
    </div>
  );
}

function CreateMarketModal({ onClose, onCreate }: { onClose: () => void; onCreate: (m: Market) => void }) {
  const { address } = useAccount();
  const [tab,       setTab]       = useState<"btc"|"custom">("btc");
  const [duration,  setDuration]  = useState(300);
  const [question,  setQuestion]  = useState("");
  const [category,  setCategory]  = useState("sports");
  const [desc,      setDesc]      = useState("");
  const [creating,  setCreating]  = useState(false);
  const [error,     setError]     = useState<string|null>(null);
  const [submitted, setSubmitted] = useState(false);

  const durations  = [{l:"1m",v:60},{l:"5m",v:300},{l:"15m",v:900},{l:"1h",v:3600},{l:"1d",v:86400}];
  const categories = ["sports","politics","crypto","tech","entertainment","other"];

  async function createBtc() {
    setCreating(true); setError(null);
    try {
      const r = await fetch("http://localhost:3000/market/create/btc", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ duration }),
      });
      const m = await r.json();
      if (m.error) throw new Error(m.error);
      onCreate(m); onClose();
    } catch(e: any) { setError(e.message); }
    setCreating(false);
  }

  async function submitCustom() {
    if (!address) { setError("Connect wallet first"); return; }
    if (question.trim().length < 10) { setError("Question too short (min 10 chars)"); return; }
    setCreating(true); setError(null);
    try {
      const r = await fetch("http://localhost:3000/market/proposal/submit", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ creator: address, type:"CUSTOM", question: question.trim(), description: desc, category, duration: 86400 }),
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error);
      setSubmitted(true);
    } catch(e: any) { setError(e.message); }
    setCreating(false);
  }

  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.75)",zIndex:100,display:"flex",alignItems:"center",justifyContent:"center"}}
      onClick={onClose}>
      <div style={{background:"var(--surface)",border:"1px solid var(--border)",borderRadius:16,padding:24,width:420,maxWidth:"95vw"}}
        onClick={e => e.stopPropagation()}>
        <div style={{fontWeight:700,fontSize:16,marginBottom:16}}>Create Market</div>

        <div style={{display:"flex",gap:0,background:"var(--surface2)",borderRadius:8,padding:3,marginBottom:20}}>
          {([["btc","₿ BTC Price"],["custom","✏️ Custom"]] as const).map(([t,l]) => (
            <button key={t} onClick={() => setTab(t)} style={{flex:1,padding:"7px 0",fontSize:13,fontWeight:tab===t?600:400,borderRadius:6,border:"none",cursor:"pointer",
              background:tab===t?"var(--surface)":"transparent",color:tab===t?"var(--text)":"var(--text3)"}}>{l}</button>
          ))}
        </div>

        {tab === "btc" ? (<>
          <div style={{fontSize:12,color:"var(--text2)",marginBottom:12}}>Will BTC be higher than <strong style={{color:"#f59e0b"}}>current price</strong> in:</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(5,1fr)",gap:6,marginBottom:20}}>
            {durations.map(d => (
              <button key={d.v} onClick={() => setDuration(d.v)} style={{padding:"9px 0",fontSize:12,fontWeight:600,borderRadius:8,cursor:"pointer",
                background:duration===d.v?"#f59e0b":"var(--surface2)",color:duration===d.v?"black":"var(--text2)",border:"1px solid var(--border)"}}>{d.l}</button>
            ))}
          </div>
          {error && <div style={{background:"rgba(234,57,67,0.1)",color:"var(--red)",padding:"8px 12px",borderRadius:8,fontSize:12,marginBottom:12}}>{error}</div>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={onClose} style={{flex:1,padding:"11px 0",borderRadius:8,background:"var(--surface2)",color:"var(--text2)",border:"1px solid var(--border)",fontSize:13,cursor:"pointer"}}>Cancel</button>
            <button onClick={createBtc} disabled={creating} style={{flex:2,padding:"11px 0",borderRadius:8,background:creating?"var(--surface2)":"linear-gradient(135deg,#f59e0b,#ef4444)",color:creating?"var(--text3)":"white",border:"none",fontSize:13,fontWeight:600,cursor:"pointer"}}>
              {creating ? "Creating..." : "🚀 Launch Now"}
            </button>
          </div>
        </>) : submitted ? (
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:40,marginBottom:12}}>✅</div>
            <div style={{fontWeight:600,fontSize:15,marginBottom:6}}>Submitted for Review</div>
            <div style={{fontSize:13,color:"var(--text3)",marginBottom:20}}>Your market will go live once approved by an admin.</div>
            <button onClick={onClose} style={{padding:"10px 24px",borderRadius:8,background:"var(--surface2)",color:"var(--text2)",border:"1px solid var(--border)",fontSize:13,cursor:"pointer"}}>Close</button>
          </div>
        ) : (<>
          <div style={{display:"flex",flexDirection:"column",gap:12,marginBottom:20}}>
            <div>
              <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:5,fontWeight:500}}>CATEGORY</label>
              <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                {categories.map(c => (
                  <button key={c} onClick={() => setCategory(c)} style={{padding:"5px 12px",fontSize:11,fontWeight:600,borderRadius:6,cursor:"pointer",border:"1px solid var(--border)",
                    background:category===c?"#3b82f6":"var(--surface2)",color:category===c?"white":"var(--text2)",textTransform:"capitalize"}}>{c}</button>
                ))}
              </div>
            </div>
            <div>
              <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:5,fontWeight:500}}>QUESTION</label>
              <input value={question} onChange={e => setQuestion(e.target.value)} placeholder="Will X happen by [date]?"
                style={{width:"100%",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",fontSize:13,color:"var(--text)",outline:"none",boxSizing:"border-box"}} />
            </div>
            <div>
              <label style={{fontSize:11,color:"var(--text3)",display:"block",marginBottom:5,fontWeight:500}}>DESCRIPTION (optional)</label>
              <textarea value={desc} onChange={e => setDesc(e.target.value)} placeholder="Resolution criteria..." rows={3}
                style={{width:"100%",background:"var(--surface2)",border:"1px solid var(--border)",borderRadius:8,padding:"10px 12px",fontSize:13,color:"var(--text)",outline:"none",resize:"none",boxSizing:"border-box"}} />
            </div>
            <div style={{fontSize:11,color:"var(--text3)",background:"var(--surface2)",padding:"8px 12px",borderRadius:8}}>
              ⏳ Custom markets require admin approval before going live
            </div>
          </div>
          {error && <div style={{background:"rgba(234,57,67,0.1)",color:"var(--red)",padding:"8px 12px",borderRadius:8,fontSize:12,marginBottom:12}}>{error}</div>}
          <div style={{display:"flex",gap:8}}>
            <button onClick={onClose} style={{flex:1,padding:"11px 0",borderRadius:8,background:"var(--surface2)",color:"var(--text2)",border:"1px solid var(--border)",fontSize:13,cursor:"pointer"}}>Cancel</button>
            <button onClick={submitCustom} disabled={creating||!address} style={{flex:2,padding:"11px 0",borderRadius:8,background:creating?"var(--surface2)":"#3b82f6",color:creating?"var(--text3)":"white",border:"none",fontSize:13,fontWeight:600,cursor:"pointer"}}>
              {creating ? "Submitting..." : "📝 Submit for Review"}
            </button>
          </div>
        </>)}
      </div>
    </div>
  );
}


export default function MarketsPage() {
  const [markets,     setMarkets]     = useState<Market[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  
  const [filter,      setFilter]      = useState<"all"|"live"|"settled">("all");
  const [btcPrice,    setBtcPrice]    = useState<number|null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("http://localhost:3000/market/list");
        const all = await r.json();
        setMarkets(all.filter((m: Market) => !_deletedIds.has(m.questionId)));
      } catch {} finally { setLoading(false); }
    };
    load(); const id = setInterval(load, 5000); return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT");
        const d = await r.json(); setBtcPrice(parseFloat(d.price));
      } catch {}
    };
    load(); const id = setInterval(load, 5000); return () => clearInterval(id);
  }, []);

  async function deleteMarket(questionId: string) {
    try {
      await fetch(`http://localhost:3000/market/${questionId}`, { method: "DELETE" });
      _deletedIds.add(questionId);
      setMarkets(prev => prev.filter(m => m.questionId !== questionId));
    } catch {}
  }

  const filtered = markets.filter(m =>
    filter === "all" ? true : filter === "live" ? m.status === "OPEN" : m.status === "SETTLED"
  );

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      {/* Header */}
      <header style={{ background: "var(--surface)", borderBottom: "1px solid var(--border)", padding: "0 24px", height: 56, display: "flex", alignItems: "center", justifyContent: "space-between", position: "sticky", top: 0, zIndex: 50 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 28, height: 28, borderRadius: 8, background: "linear-gradient(135deg,#3b82f6,#8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 700, color: "white" }}>P</div>
            <span style={{ fontWeight: 700, fontSize: 16 }}>Polymarket <span style={{ color: "var(--text3)", fontWeight: 400 }}>Mini</span></span>
          </div>
          {btcPrice && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "4px 10px", background: "var(--surface2)", borderRadius: 8, border: "1px solid var(--border)" }}>
              <span style={{ fontSize: 12 }}>₿</span>
              <span className="mono" style={{ fontSize: 13, fontWeight: 600 }}>${btcPrice.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            </div>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <button onClick={() => setShowCreate(true)}
            style={{ padding: "7px 16px", borderRadius: 8, background: "linear-gradient(135deg,#f59e0b,#ef4444)", color: "white", border: "none", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
            + Create Market
          </button>
          <Link href="/admin" style={{fontSize:12,color:"var(--text3)",textDecoration:"none",padding:"6px 12px",border:"1px solid var(--border)",borderRadius:6}}>Admin</Link>
          <ConnectButton chainStatus="none" showBalance={false} label="Connect" />
        </div>
      </header>

      {/* Body */}
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 16px" }}>
        {/* Filters */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <h1 style={{ fontSize: 22, fontWeight: 700 }}>Markets</h1>
          <div style={{ display: "flex", gap: 6, background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, padding: 3 }}>
            {(["all","live","settled"] as const).map(f => (
              <button key={f} onClick={() => setFilter(f)}
                style={{
                  padding: "5px 14px", fontSize: 12, fontWeight: 600, borderRadius: 6, cursor: "pointer", border: "none",
                  background: filter === f ? "var(--surface2)" : "transparent",
                  color: filter === f ? "var(--text)" : "var(--text3)",
                  textTransform: "capitalize",
                }}>{f}</button>
            ))}
          </div>
        </div>

        {/* Grid */}
        {loading ? (
          <div style={{ textAlign: "center", padding: 80, color: "var(--text3)" }}>Loading markets...</div>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: "center", padding: 80 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📊</div>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>No markets yet</div>
            <div style={{ fontSize: 13, color: "var(--text3)", marginBottom: 20 }}>Create the first prediction market</div>
            <button onClick={() => setShowCreate(true)}
              style={{ padding: "10px 24px", borderRadius: 8, background: "linear-gradient(135deg,#f59e0b,#ef4444)", color: "white", border: "none", fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
              + Create Market
            </button>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px,1fr))", gap: 16 }}>
            {filtered.map(m => <MarketCard key={m.questionId} market={m} onDelete={deleteMarket} />)}
          </div>
        )}
      </div>

      {showCreate && (
        <CreateMarketModal
          onClose={() => setShowCreate(false)}
          onCreate={m => setMarkets(prev => [m, ...prev])}
        />
      )}
    </div>
  );
}
