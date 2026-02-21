"use client";
import { ConnectButton } from "@rainbow-me/rainbowkit";

export default function MarketHeader() {
  return (
    <header style={{
      background: "var(--surface)",
      borderBottom: "1px solid var(--border)",
      padding: "0 24px",
      height: 56,
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        {/* Logo */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 8,
            background: "linear-gradient(135deg, #3b82f6, #8b5cf6)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 14, fontWeight: 700, color: "white",
          }}>P</div>
          <span style={{ fontWeight: 600, fontSize: 15, color: "var(--text)" }}>
            Polymarket <span style={{ color: "var(--text3)", fontWeight: 400 }}>Mini</span>
          </span>
        </div>

        {/* Divider */}
        <div style={{ width: 1, height: 20, background: "var(--border)" }} />

        {/* Market */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{
            width: 8, height: 8, borderRadius: "50%",
            background: "var(--green)",
            boxShadow: "0 0 8px var(--green)",
          }} />
          <span style={{ color: "var(--text2)", fontSize: 13 }}>Will ETH hit $10K?</span>
        </div>
      </div>

      <ConnectButton
        chainStatus="none"
        showBalance={false}
        label="Connect Wallet"
      />
    </header>
  );
}
