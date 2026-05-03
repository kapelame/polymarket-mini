"use client";
import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import Link from "next/link";
import WalletButton from "../../components/WalletButton";

const ADMIN = "0x70997970c51812dc3a010c7d01b50e0d17dc79c8";
const CATEGORY_EMOJI: Record<string,string> = {sports:"⚽",politics:"🏛️",crypto:"₿",tech:"💻",entertainment:"🎬",other:"🔮"};

interface Proposal {
  id:string; creator:string; type:string; question:string; description:string;
  category:string; duration:number; status:string; created_at:number;
  reviewed_at:number|null; reviewer:string|null; reject_reason:string|null;
}

export default function AdminPage() {
  const { address } = useAccount();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [filter,    setFilter]    = useState<"PENDING"|"all">("PENDING");
  const [loading,   setLoading]   = useState(true);
  const [actionId,  setActionId]  = useState<string|null>(null);
  const [rejectId,  setRejectId]  = useState<string|null>(null);
  const [reason,    setReason]    = useState("");
  const [toast,     setToast]     = useState<string|null>(null);

  const isAdmin = address?.toLowerCase() === ADMIN;

  const showToast = (msg: string) => { setToast(msg); setTimeout(() => setToast(null), 3000); };

  const load = async () => {
    if (!address) return;
    setLoading(true);
    try {
      const url = filter === "PENDING"
        ? "http://localhost:3000/market/proposal/pending"
        : "http://localhost:3000/market/proposal/all";
      const r = await fetch(url, { headers: { "x-address": address } });
      setProposals(await r.json());
    } catch {} finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [address, filter]);

  async function approve(id: string) {
    if (!address) return;
    setActionId(id);
    try {
      const r = await fetch(`http://localhost:3000/market/proposal/approve/${id}`, {
        method:"POST", headers:{"x-address":address,"Content-Type":"application/json"}
      });
      const d = await r.json();
      if (d.error) showToast("❌ " + d.error);
      else { showToast("✅ Market approved and deployed!"); load(); }
    } catch(e:any) { showToast("❌ " + e.message); }
    setActionId(null);
  }

  async function reject(id: string) {
    if (!address) return;
    setActionId(id);
    try {
      await fetch(`http://localhost:3000/market/proposal/reject/${id}`, {
        method:"POST",
        headers:{"x-address":address,"Content-Type":"application/json"},
        body: JSON.stringify({ reason: reason || "Does not meet guidelines" }),
      });
      showToast("Market rejected");
      setRejectId(null); setReason(""); load();
    } catch {}
    setActionId(null);
  }

  return (
    <div style={{minHeight:"100vh",background:"var(--bg)"}}>
      {toast && (
        <div style={{position:"fixed",top:16,right:16,zIndex:200,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:10,padding:"12px 20px",fontSize:13,fontWeight:500,boxShadow:"0 4px 20px rgba(0,0,0,0.3)"}}>
          {toast}
        </div>
      )}

      <header style={{background:"var(--surface)",borderBottom:"1px solid var(--border)",padding:"0 24px",height:56,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:50}}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <Link href="/" style={{color:"var(--text3)",fontSize:13,textDecoration:"none"}}>← Markets</Link>
          <div style={{width:1,height:16,background:"var(--border)"}}/>
          <span style={{fontWeight:700,fontSize:15}}>Admin Panel</span>
          {isAdmin && <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:5,background:"rgba(59,130,246,0.15)",color:"#3b82f6"}}>ADMIN</span>}
        </div>
        <WalletButton />
      </header>

      <div style={{maxWidth:860,margin:"0 auto",padding:"24px 16px"}}>
        {!address ? (
          <div style={{textAlign:"center",padding:80,color:"var(--text3)"}}>Connect wallet to access admin panel</div>
        ) : !isAdmin ? (
          <div style={{textAlign:"center",padding:80}}>
            <div style={{fontSize:40,marginBottom:12}}>🔒</div>
            <div style={{fontWeight:600,fontSize:16}}>Access Denied</div>
            <div style={{fontSize:13,color:"var(--text3)",marginTop:6}}>Only the admin wallet can access this page</div>
          </div>
        ) : (
          <>
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:20}}>
              <h1 style={{fontSize:20,fontWeight:700,margin:0}}>Market Proposals</h1>
              <div style={{display:"flex",gap:4,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:8,padding:3}}>
                {(["PENDING","all"] as const).map(f => (
                  <button key={f} onClick={() => setFilter(f)} style={{padding:"5px 14px",fontSize:12,fontWeight:600,borderRadius:6,cursor:"pointer",border:"none",
                    background:filter===f?"var(--surface2)":"transparent",color:filter===f?"var(--text)":"var(--text3)"}}>
                    {f === "PENDING" ? "Pending" : "All"}
                  </button>
                ))}
              </div>
            </div>

            {loading ? (
              <div style={{textAlign:"center",padding:60,color:"var(--text3)"}}>Loading...</div>
            ) : proposals.length === 0 ? (
              <div style={{textAlign:"center",padding:60}}>
                <div style={{fontSize:40,marginBottom:12}}>📭</div>
                <div style={{fontSize:15,fontWeight:600,marginBottom:6}}>No proposals</div>
                <div style={{fontSize:13,color:"var(--text3)"}}>New market submissions will appear here</div>
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:12}}>
                {proposals.map(p => (
                  <div key={p.id} style={{background:"var(--surface)",border:`1px solid ${p.status==="PENDING"?"var(--border)":p.status==="DEPLOYED"?"rgba(22,199,132,0.25)":"rgba(234,57,67,0.25)"}`,borderRadius:12,overflow:"hidden"}}>
                    <div style={{padding:16}}>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
                        <div style={{display:"flex",gap:8,alignItems:"center"}}>
                          <span style={{fontSize:18}}>{CATEGORY_EMOJI[p.category]||"🔮"}</span>
                          <span style={{fontSize:11,fontWeight:600,padding:"2px 8px",borderRadius:5,textTransform:"capitalize",background:"var(--surface2)",color:"var(--text3)"}}>{p.category}</span>
                          <span style={{fontSize:10,fontWeight:700,padding:"2px 8px",borderRadius:5,
                            background:p.status==="PENDING"?"rgba(245,158,11,0.15)":p.status==="DEPLOYED"?"rgba(22,199,132,0.15)":"rgba(234,57,67,0.15)",
                            color:p.status==="PENDING"?"#f59e0b":p.status==="DEPLOYED"?"var(--green)":"var(--red)"}}>
                            {p.status}
                          </span>
                        </div>
                        <span style={{fontSize:11,color:"var(--text3)"}}>{new Date(p.created_at*1000).toLocaleDateString()}</span>
                      </div>
                      <div style={{fontSize:15,fontWeight:600,marginBottom:6}}>{p.question}</div>
                      {p.description && <div style={{fontSize:12,color:"var(--text3)",marginBottom:8}}>{p.description}</div>}
                      <div style={{fontSize:11,color:"var(--text3)"}}>
                        Creator: <span style={{fontFamily:"monospace"}}>{p.creator.slice(0,6)}...{p.creator.slice(-4)}</span>
                        {p.reject_reason && <span style={{marginLeft:12,color:"var(--red)"}}>Reason: {p.reject_reason}</span>}
                      </div>
                    </div>
                    {p.status === "PENDING" && (
                      <div style={{borderTop:"1px solid var(--border)",padding:"10px 16px",background:"var(--surface2)",display:"flex",gap:8}}>
                        {rejectId === p.id ? (
                          <>
                            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Rejection reason..."
                              style={{flex:1,background:"var(--surface)",border:"1px solid var(--border)",borderRadius:6,padding:"6px 10px",fontSize:12,color:"var(--text)",outline:"none"}} />
                            <button onClick={() => reject(p.id)} disabled={actionId===p.id}
                              style={{padding:"6px 16px",borderRadius:6,background:"var(--red)",color:"white",border:"none",fontSize:12,fontWeight:600,cursor:"pointer"}}>Confirm</button>
                            <button onClick={() => setRejectId(null)}
                              style={{padding:"6px 12px",borderRadius:6,background:"var(--surface)",color:"var(--text2)",border:"1px solid var(--border)",fontSize:12,cursor:"pointer"}}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => approve(p.id)} disabled={actionId===p.id}
                              style={{flex:1,padding:"8px 0",borderRadius:8,background:actionId===p.id?"var(--surface)":"var(--green)",color:actionId===p.id?"var(--text3)":"black",border:"none",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                              {actionId===p.id ? "Deploying..." : "✅ Approve & Deploy"}
                            </button>
                            <button onClick={() => setRejectId(p.id)}
                              style={{padding:"8px 20px",borderRadius:8,background:"rgba(234,57,67,0.1)",color:"var(--red)",border:"1px solid rgba(234,57,67,0.3)",fontSize:13,fontWeight:600,cursor:"pointer"}}>
                              ❌ Reject
                            </button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
