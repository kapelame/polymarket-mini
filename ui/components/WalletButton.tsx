"use client";

import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";

function shortAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

function connectorLabel(id: string, name: string) {
  if (id === "mock") return "Demo Wallet";
  if (id === "injected" && name === "Injected") return "Browser Wallet";
  return name;
}

export default function WalletButton() {
  const menuRef = useRef<HTMLDivElement>(null);
  const { address, isConnected } = useAccount();
  const { connectAsync, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    function close(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    }
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  async function connectWallet(connector: (typeof connectors)[number]) {
    setStatus(null);
    try {
      await connectAsync({ connector, chainId: 31337 });
      setOpen(false);
    } catch (err) {
      setStatus(err instanceof Error ? err.message.slice(0, 96) : "Connection failed");
    }
  }

  return (
    <div className="wallet-connect" ref={menuRef}>
      <button className="pm-button primary" type="button" onClick={() => setOpen((value) => !value)}>
        {isConnected && address ? shortAddress(address) : "Connect"}
      </button>

      {open && (
        <div className="wallet-menu">
          {isConnected && address ? (
            <>
              <div className="wallet-menu-header mono">{shortAddress(address)}</div>
              <button className="wallet-option" type="button" onClick={() => { disconnect(); setOpen(false); }}>
                Disconnect
              </button>
            </>
          ) : (
            <>
              {connectors.map((connector) => (
                <button className="wallet-option" type="button" key={connector.uid} disabled={isPending} onClick={() => connectWallet(connector)}>
                  <span>{connectorLabel(connector.id, connector.name)}</span>
                  <span className="subtle">{connector.id === "mock" ? "Anvil" : "Injected"}</span>
                </button>
              ))}
              {status && <div className="wallet-status">{status}</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
