"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useSignTypedData } from "wagmi";
import { formatUnits } from "viem";
import { USDC_ABI } from "../lib/contracts";
import { USDC_ADDRESS } from "../lib/signing";
import { ensureApiCreds, fetchAccountDashboard, type AccountDashboard } from "../lib/clob";

type AccountTab = "positions" | "fills" | "orders";

function money(value: number, digits = 2) {
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function shares(value: number) {
  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function cents(value: number) {
  return `${Math.round(value * 100)}c`;
}

function time(value?: number) {
  return value ? new Date(value * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Now";
}

function shortQuestion(question: string) {
  return question.length > 58 ? `${question.slice(0, 55)}...` : question;
}

export default function AccountPanel({ compact = false }: { compact?: boolean }) {
  const { address } = useAccount();
  const { signTypedDataAsync } = useSignTypedData();
  const [tab, setTab] = useState<AccountTab>("positions");
  const [data, setData] = useState<AccountDashboard | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { data: usdcBal } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  async function load() {
    if (!address) return;
    const connectedAddress = address;
    setLoading(true);
    setError(null);
    try {
      await ensureApiCreds(connectedAddress, signTypedDataAsync);
      setData(await fetchAccountDashboard(connectedAddress));
    } catch (err) {
      setError(err instanceof Error ? err.message.slice(0, 120) : "Could not load portfolio");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!address) {
      setData(null);
      return;
    }
    const connectedAddress = address;
    let cancelled = false;
    async function initialLoad() {
      try {
        await ensureApiCreds(connectedAddress, signTypedDataAsync);
        const next = await fetchAccountDashboard(connectedAddress);
        if (!cancelled) {
          setData(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message.slice(0, 120) : "Could not load portfolio");
      }
    }
    initialLoad();
    const id = window.setInterval(initialLoad, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [address, signTypedDataAsync]);

  const summary = data?.summary;
  const topPnl = summary?.totalPnl || 0;
  const usdc = usdcBal !== undefined ? Number(formatUnits(usdcBal as bigint, 6)) : null;
  const rows = useMemo(() => ({
    positions: data?.positions || [],
    fills: data?.trades || [],
    orders: data?.orders || [],
  }), [data]);

  if (!address) {
    return (
      <section className="side-panel account-panel">
        <div className="panel-heading">
          <h2>Portfolio</h2>
          <span className="subtle">Wallet</span>
        </div>
        <div className="account-empty">
          <strong>Connect wallet</strong>
          <span>Positions, fills, and P&L will appear here.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="side-panel account-panel">
      <div className="panel-heading">
        <h2>Portfolio</h2>
        <button className="small-link" type="button" disabled={loading} onClick={load}>
          {loading ? "Loading" : "Refresh"}
        </button>
      </div>

      <div className="portfolio-summary">
        <div className="portfolio-primary">
          <span>Total P&L</span>
          <strong className={`mono ${topPnl >= 0 ? "is-profit" : "is-loss"}`}>{money(topPnl)}</strong>
        </div>
        <div className="portfolio-grid">
          <div>
            <span>USDC</span>
            <strong className="mono">{usdc === null ? "--" : money(usdc)}</strong>
          </div>
          <div>
            <span>Position value</span>
            <strong className="mono">{money(summary?.positionValue || 0)}</strong>
          </div>
          <div>
            <span>Volume</span>
            <strong className="mono">{money(summary?.totalVolume || 0)}</strong>
          </div>
          <div>
            <span>Fills</span>
            <strong className="mono">{summary?.tradeCount || 0}</strong>
          </div>
        </div>
      </div>

      {error && <div className="account-alert">{error}</div>}

      <div className="account-tabs">
        {([
          ["positions", "Positions"],
          ["fills", "Fills"],
          ["orders", "Orders"],
        ] as const).map(([key, label]) => (
          <button key={key} className={tab === key ? "active" : ""} type="button" onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      <div className={compact ? "account-list compact" : "account-list"}>
        {tab === "positions" && (
          rows.positions.length === 0 ? (
            <div className="account-empty small">No positions yet.</div>
          ) : rows.positions.slice(0, compact ? 4 : 8).map((position) => (
            <Link className="account-row" href={position.marketId ? `/market/${position.marketId}` : "#"} key={`${position.marketId || position.tokenId}-${position.outcome}`}>
              <div>
                <strong>{position.outcome} · {shares(position.shares)} shares</strong>
                <span>{shortQuestion(position.question)}</span>
              </div>
              <div className="account-row-right">
                <strong className={position.pnl >= 0 ? "is-profit" : "is-loss"}>{money(position.pnl)}</strong>
                <span>{cents(position.currentPrice)} mark</span>
              </div>
            </Link>
          ))
        )}

        {tab === "fills" && (
          rows.fills.length === 0 ? (
            <div className="account-empty small">No fills yet.</div>
          ) : rows.fills.slice(0, compact ? 5 : 10).map((fill) => (
            <Link className="account-row" href={fill.marketId ? `/market/${fill.marketId}` : "#"} key={fill.tradeId}>
              <div>
                <strong>{fill.side} {fill.outcome} · {cents(fill.price)}</strong>
                <span>{shortQuestion(fill.question)}</span>
              </div>
              <div className="account-row-right">
                <strong>{shares(fill.shares)}</strong>
                <span>{time(fill.createdAt)}</span>
              </div>
            </Link>
          ))
        )}

        {tab === "orders" && (
          rows.orders.length === 0 ? (
            <div className="account-empty small">No order history yet.</div>
          ) : rows.orders.slice(0, compact ? 5 : 10).map((order) => (
            <Link className="account-row" href={order.marketId ? `/market/${order.marketId}` : "#"} key={order.orderId}>
              <div>
                <strong>{order.side} {order.outcome} · {order.status}</strong>
                <span>{shortQuestion(order.question)}</span>
              </div>
              <div className="account-row-right">
                <strong>{cents(order.price)}</strong>
                <span>{shares(order.shares)} shares</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </section>
  );
}
