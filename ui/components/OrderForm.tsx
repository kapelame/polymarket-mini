"use client";
import { useState } from "react";
import { useAccount, useWriteContract, useReadContract, useSignTypedData } from "wagmi";
import { formatUnits, maxUint256 } from "viem";
import {
  EXCHANGE_ADDRESS, USDC_ADDRESS, CTF_ADDRESS,
  YES_TOKEN, NO_TOKEN, CHAIN_ID,
  AUTH_DOMAIN, AUTH_TYPES, AUTH_MSG,
} from "../lib/signing";
import { EXCHANGE_ABI, USDC_ABI, CTF_ABI } from "../lib/contracts";
import { postOrder, getApiKey, setCreds, getCreds, type ApiCreds } from "../lib/clob";

type Side  = "BUY" | "SELL";
type Token = "YES" | "NO";

const STEPS = ["Authenticating", "Signing order", "Registering on-chain", "Posting to CLOB"];

interface OFProps { yesToken?: string; noToken?: string; question?: string; }
export default function OrderForm({ yesToken: _yesToken, noToken: _noToken, question }: OFProps) {
  const { address } = useAccount();
  const YES_TK = _yesToken || YES_TOKEN;
  const NO_TK  = _noToken  || NO_TOKEN;
  const [side,    setSide]    = useState<Side>("BUY");
  const [token,   setToken]   = useState<Token>("YES");
  const [price,   setPrice]   = useState("0.60");
  const [size,    setSize]    = useState("100");
  const [status,  setStatus]  = useState<string | null>(null);
  const [step,    setStep]    = useState<number>(-1);
  const [loading, setLoading] = useState(false);

  const tokenId = token === "YES" ? YES_TK : NO_TK;

  const { data: usdcBal } = useReadContract({
    address: USDC_ADDRESS, abi: USDC_ABI, functionName: "balanceOf",
    args: address ? [address] : undefined, query: { enabled: !!address, refetchInterval: 3000 },
  });
  const { data: yesBal } = useReadContract({
    address: CTF_ADDRESS, abi: CTF_ABI, functionName: "balanceOf",
    args: address ? [address, BigInt(YES_TK)] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });
  const { data: noBal } = useReadContract({
    address: CTF_ADDRESS, abi: CTF_ABI, functionName: "balanceOf",
    args: address ? [address, BigInt(NO_TK)] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });
  const { data: usdcAllowance } = useReadContract({
    address: USDC_ADDRESS, abi: USDC_ABI, functionName: "allowance",
    args: address ? [address, EXCHANGE_ADDRESS] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });
  const { data: erc1155Ok } = useReadContract({
    address: CTF_ADDRESS, abi: CTF_ABI, functionName: "isApprovedForAll",
    args: address ? [address, EXCHANGE_ADDRESS] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync }  = useSignTypedData();

  const needUsdcApproval = side === "BUY"  && (!usdcAllowance || usdcAllowance === 0n);
  const needErcApproval  = side === "SELL" && !erc1155Ok;

  const fmt = (v: bigint | undefined, d = 6) =>
    v !== undefined ? parseFloat(formatUnits(v, d)).toFixed(2) : "—";

  const total = (() => {
    try { return (parseFloat(price) * parseFloat(size)).toFixed(2); } catch { return "—"; }
  })();

  async function ensureAuth(): Promise<ApiCreds> {
    if (getCreds()?.address === address) return getCreds()!;
    const ts  = String(Math.floor(Date.now() / 1000));
    const sig = await signTypedDataAsync({
      domain: { ...AUTH_DOMAIN, chainId: CHAIN_ID } as any,
      types: AUTH_TYPES, primaryType: "ClobAuth",
      message: { address: address!, timestamp: ts, nonce: 0, message: AUTH_MSG },
    });
    const creds = await getApiKey(address!, ts, 0, sig);
    if (creds.error) throw new Error(creds.error);
    creds.address = address!;
    setCreds(creds);
    return creds;
  }

  async function approve(type: "usdc" | "erc1155") {
    setLoading(true);
    try {
      if (type === "usdc") {
        setStatus("Approving USDC...");
        await writeContractAsync({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "approve", args: [EXCHANGE_ADDRESS, maxUint256] });
        setStatus("✓ USDC approved");
      } else {
        setStatus("Approving tokens...");
        await writeContractAsync({ address: CTF_ADDRESS, abi: CTF_ABI, functionName: "setApprovalForAll", args: [EXCHANGE_ADDRESS, true] });
        setStatus("✓ Tokens approved");
      }
    } catch (e: any) { setStatus(`✗ ${e.message?.slice(0, 60)}`); }
    setLoading(false);
  }

  async function placeOrder() {
    if (!address) return;
    setLoading(true); setStep(0); setStatus(null);
    try {
      const creds = await ensureAuth();
      setStep(1);

      const p  = parseFloat(price);
      const sz = parseFloat(size);
      const makerAmount = side === "BUY" ? BigInt(Math.round(p * sz * 1e6)) : BigInt(Math.round(sz * 1e6));
      const takerAmount = side === "BUY" ? BigInt(Math.round(sz * 1e6))     : BigInt(Math.round(p * sz * 1e6));
      const salt  = BigInt(Date.now());
      const order = {
        salt, maker: address as `0x${string}`, signer: address as `0x${string}`,
        taker: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        tokenId: BigInt(tokenId), makerAmount, takerAmount,
        expiration: 0n, nonce: 0n, feeRateBps: 0n,
        side: side === "BUY" ? 0 : 1, signatureType: 0,
      };

      const signature = await signTypedDataAsync({
        domain: { name: "CTFExchange", version: "1", chainId: CHAIN_ID, verifyingContract: EXCHANGE_ADDRESS },
        types: { Order: [
          { name: "salt", type: "uint256" }, { name: "maker", type: "address" },
          { name: "signer", type: "address" }, { name: "taker", type: "address" },
          { name: "tokenId", type: "uint256" }, { name: "makerAmount", type: "uint256" },
          { name: "takerAmount", type: "uint256" }, { name: "expiration", type: "uint256" },
          { name: "nonce", type: "uint256" }, { name: "feeRateBps", type: "uint256" },
          { name: "side", type: "uint8" }, { name: "signatureType", type: "uint8" },
        ]},
        primaryType: "Order",
        message: { ...order, side: order.side as any, signatureType: order.signatureType as any },
      });

      setStep(2);
      await writeContractAsync({
        address: EXCHANGE_ADDRESS, abi: EXCHANGE_ABI,
        functionName: "registerOrder", args: [{ ...order, signature }],
      });

      setStep(3);
      const result = await postOrder({
        salt: salt.toString(), maker: address, signer: address,
        taker: "0x0000000000000000000000000000000000000000",
        tokenId, makerAmount: makerAmount.toString(), takerAmount: takerAmount.toString(),
        expiration: "0", nonce: "0", feeRateBps: "0", side, signatureType: 0, signature,
      });
      if (result.error) throw new Error(result.error);

      setStatus(`Order placed successfully`);
      setStep(-1);
    } catch (e: any) {
      setStatus(`✗ ${e.message?.slice(0, 80)}`);
      setStep(-1);
    }
    setLoading(false);
  }

  if (!address) return (
    <div className="card" style={{
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      gap: 12, padding: 32, textAlign: "center",
    }}>
      <div style={{ fontSize: 32 }}>🔮</div>
      <div style={{ fontWeight: 600, fontSize: 15 }}>Connect your wallet</div>
      <div style={{ fontSize: 13, color: "var(--text2)" }}>
        Connect to start trading on this market
      </div>
    </div>
  );

  const isBuy = side === "BUY";
  const btnColor = isBuy ? "var(--green)" : "var(--red)";

  return (
    <div className="card" style={{ overflow: "hidden" }}>
      {/* Header */}
      <div style={{
        padding: "14px 16px",
        borderBottom: "1px solid var(--border)",
      }}>
        <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 12 }}>Trade</div>

        {/* Side selector */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr",
          background: "var(--surface2)", borderRadius: 8, padding: 3, gap: 3,
        }}>
          {(["BUY", "SELL"] as Side[]).map(s => (
            <button key={s} onClick={() => setSide(s)} className="btn"
              style={{
                padding: "8px 0", fontSize: 13, fontWeight: 600, borderRadius: 6,
                background: side === s ? (s === "BUY" ? "var(--green)" : "var(--red)") : "transparent",
                color: side === s ? "white" : "var(--text2)",
              }}>
              {s}
            </button>
          ))}
        </div>
      </div>

      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Balances */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
        }}>
          {[
            { label: "USDC", value: fmt(usdcBal) },
            { label: "YES",  value: fmt(yesBal)  },
            { label: "NO",   value: fmt(noBal)   },
          ].map(({ label, value }) => (
            <div key={label} style={{
              background: "var(--surface2)", borderRadius: 8,
              padding: "8px 10px",
            }}>
              <div style={{ fontSize: 10, color: "var(--text3)", marginBottom: 2, fontWeight: 500 }}>{label}</div>
              <div className="mono" style={{ fontSize: 13, fontWeight: 500 }}>{value}</div>
            </div>
          ))}
        </div>

        {/* Token selector */}
        <div>
          <label style={{ fontSize: 11, color: "var(--text3)", display: "block", marginBottom: 6, fontWeight: 500 }}>
            OUTCOME
          </label>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            background: "var(--surface2)", borderRadius: 8, padding: 3, gap: 3,
          }}>
            {(["YES", "NO"] as Token[]).map(t => (
              <button key={t} onClick={() => setToken(t)} className="btn"
                style={{
                  padding: "8px 0", fontSize: 13, fontWeight: 600, borderRadius: 6,
                  background: token === t
                    ? (t === "YES" ? "rgba(22,199,132,0.2)" : "rgba(234,57,67,0.2)")
                    : "transparent",
                  color: token === t ? (t === "YES" ? "var(--green)" : "var(--red)") : "var(--text2)",
                  border: token === t
                    ? `1px solid ${t === "YES" ? "rgba(22,199,132,0.3)" : "rgba(234,57,67,0.3)"}`
                    : "1px solid transparent",
                }}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Price input */}
        <div>
          <label style={{ fontSize: 11, color: "var(--text3)", display: "block", marginBottom: 6, fontWeight: 500 }}>
            LIMIT PRICE
          </label>
          <div style={{ position: "relative" }}>
            <input
              type="number" value={price} onChange={e => setPrice(e.target.value)}
              step="0.01" min="0" max="1"
              style={{
                width: "100%", background: "var(--surface2)",
                border: "1px solid var(--border2)", borderRadius: 8,
                padding: "10px 40px 10px 12px", fontSize: 14,
                color: "var(--text)", outline: "none", fontFamily: "inherit",
              }}
            />
            <span style={{
              position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)",
              fontSize: 12, color: "var(--text3)",
            }}>$</span>
          </div>
        </div>

        {/* Size input */}
        <div>
          <label style={{ fontSize: 11, color: "var(--text3)", display: "block", marginBottom: 6, fontWeight: 500 }}>
            SHARES
          </label>
          <input
            type="number" value={size} onChange={e => setSize(e.target.value)}
            style={{
              width: "100%", background: "var(--surface2)",
              border: "1px solid var(--border2)", borderRadius: 8,
              padding: "10px 12px", fontSize: 14,
              color: "var(--text)", outline: "none", fontFamily: "inherit",
            }}
          />
        </div>

        {/* Summary */}
        <div style={{
          background: "var(--surface2)", borderRadius: 8, padding: "12px 14px",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          {[
            ["Avg Price", `$${parseFloat(price || "0").toFixed(4)}`],
            ["Shares",    size],
            ["Total",     `$${total} USDC`],
          ].map(([k, v]) => (
            <div key={k} style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ fontSize: 12, color: "var(--text2)" }}>{k}</span>
              <span className="mono" style={{ fontSize: 12, fontWeight: 500 }}>{v}</span>
            </div>
          ))}
        </div>

        {/* Approval buttons */}
        {needUsdcApproval && (
          <button onClick={() => approve("usdc")} disabled={loading} className="btn"
            style={{ width: "100%", padding: "12px 0", fontSize: 13, fontWeight: 600,
              background: "var(--yellow)", color: "black", borderRadius: 8 }}>
            Approve USDC
          </button>
        )}
        {needErcApproval && (
          <button onClick={() => approve("erc1155")} disabled={loading} className="btn"
            style={{ width: "100%", padding: "12px 0", fontSize: 13, fontWeight: 600,
              background: "var(--yellow)", color: "black", borderRadius: 8 }}>
            Approve Tokens
          </button>
        )}

        {/* Progress steps */}
        {loading && step >= 0 && (
          <div style={{ display: "flex", gap: 4 }}>
            {STEPS.map((s, i) => (
              <div key={i} style={{
                flex: 1, height: 3, borderRadius: 2,
                background: i <= step ? btnColor : "var(--surface2)",
                transition: "background 0.3s",
              }} />
            ))}
          </div>
        )}

        {/* Place order */}
        <button
          onClick={placeOrder}
          disabled={loading || needUsdcApproval || needErcApproval}
          className="btn"
          style={{
            width: "100%", padding: "13px 0", fontSize: 14, fontWeight: 600,
            background: loading ? "var(--surface2)" : btnColor,
            color: loading ? "var(--text3)" : "white",
            borderRadius: 8,
          }}>
          {loading ? (step >= 0 ? STEPS[step] + "..." : "Processing...") : `${side} ${token}`}
        </button>

        {/* Status */}
        {status && (
          <div style={{
            background: status.startsWith("✓") || status.startsWith("Order placed")
              ? "var(--green-bg)" : "rgba(234,57,67,0.1)",
            border: `1px solid ${status.startsWith("✓") || status.startsWith("Order placed") ? "rgba(22,199,132,0.2)" : "rgba(234,57,67,0.2)"}`,
            borderRadius: 8, padding: "10px 12px",
          }}>
            <span style={{
              fontSize: 12,
              color: status.startsWith("✓") || status.startsWith("Order placed") ? "var(--green)" : "var(--red)",
            }}>{status}</span>
          </div>
        )}
      </div>
    </div>
  );
}
