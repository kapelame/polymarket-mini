"use client";

import { useEffect, useMemo, useState } from "react";
import { useAccount, useReadContract, useSignTypedData, useWriteContract } from "wagmi";
import { formatUnits, maxUint256 } from "viem";
import {
  CHAIN_ID,
  CTF_ADDRESS,
  EXCHANGE_ADDRESS,
  NO_TOKEN,
  USDC_ADDRESS,
  YES_TOKEN,
} from "../lib/signing";
import { CTF_ABI, EXCHANGE_ABI, USDC_ABI } from "../lib/contracts";
import { cancelOrder, ensureApiCreds, fetchOpenOrders, fetchOrderbook, postOrder, type ApiCreds, type OpenOrder } from "../lib/clob";

type Side = "BUY" | "SELL";
type Token = "YES" | "NO";

const STEPS = ["Authenticating", "Signing order", "Registering", "Posting"];

interface OrderFormProps {
  yesToken?: string;
  noToken?: string;
  question?: string;
}

function cents(value: number) {
  return `${Math.max(1, Math.round(value * 100))}c`;
}

function shortOrderId(orderId: string) {
  return orderId.length > 18 ? `${orderId.slice(0, 8)}...${orderId.slice(-6)}` : orderId;
}

function getOrderId(order: OpenOrder) {
  return order.order_id || order.orderId || order.id || "";
}

function getOrderTokenId(order: OpenOrder) {
  return order.token_id || order.tokenId || "";
}

function getOrderPrice(order: OpenOrder) {
  const explicit = Number(order.price);
  if (Number.isFinite(explicit)) return explicit;
  const makerAmount = Number(order.maker_amount || order.makerAmount || 0);
  const takerAmount = Number(order.taker_amount || order.takerAmount || 0);
  if (!makerAmount || !takerAmount) return 0;
  return order.side === "BUY" ? makerAmount / takerAmount : takerAmount / makerAmount;
}

function onlyLiveOrders(items: OpenOrder[], yesToken: string, noToken: string) {
  return items.filter((order) => {
    const status = String(order.status || "OPEN").toUpperCase();
    const tokenId = getOrderTokenId(order);
    return (status === "OPEN" || status === "PARTIAL") && (tokenId === yesToken || tokenId === noToken);
  });
}

export default function OrderForm({ yesToken: yesTokenProp, noToken: noTokenProp }: OrderFormProps) {
  const { address } = useAccount();
  const yesToken = yesTokenProp || YES_TOKEN;
  const noToken = noTokenProp || NO_TOKEN;
  const [side, setSide] = useState<Side>("BUY");
  const [token, setToken] = useState<Token>("YES");
  const [price, setPrice] = useState("0.50");
  const [size, setSize] = useState("10");
  const [yesBest, setYesBest] = useState({ bid: 0.5, ask: 0.5 });
  const [noBest, setNoBest] = useState({ bid: 0.5, ask: 0.5 });
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [step, setStep] = useState(-1);
  const [loading, setLoading] = useState(false);
  const [ordersLoading, setOrdersLoading] = useState(false);

  const tokenId = token === "YES" ? yesToken : noToken;
  const best = token === "YES" ? yesBest : noBest;
  const numericPrice = Number(price || 0);
  const numericSize = Number(size || 0);
  const total = useMemo(() => (Number.isFinite(numericPrice * numericSize) ? numericPrice * numericSize : 0), [numericPrice, numericSize]);
  const maxPayout = side === "BUY" ? numericSize : total;
  const potentialProfit = side === "BUY" ? Math.max(0, numericSize - total) : total;

  const { data: usdcBal } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });
  const { data: yesBal } = useReadContract({
    address: CTF_ADDRESS,
    abi: CTF_ABI,
    functionName: "balanceOf",
    args: address ? [address, BigInt(yesToken)] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });
  const { data: noBal } = useReadContract({
    address: CTF_ADDRESS,
    abi: CTF_ABI,
    functionName: "balanceOf",
    args: address ? [address, BigInt(noToken)] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });
  const { data: usdcAllowance } = useReadContract({
    address: USDC_ADDRESS,
    abi: USDC_ABI,
    functionName: "allowance",
    args: address ? [address, EXCHANGE_ADDRESS] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });
  const { data: erc1155Ok } = useReadContract({
    address: CTF_ADDRESS,
    abi: CTF_ABI,
    functionName: "isApprovedForAll",
    args: address ? [address, EXCHANGE_ADDRESS] : undefined,
    query: { enabled: !!address, refetchInterval: 3000 },
  });

  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const usdcAllowanceValue = usdcAllowance as bigint | undefined;
  const erc1155Approved = erc1155Ok as boolean | undefined;
  const needUsdcApproval = side === "BUY" && (!usdcAllowanceValue || usdcAllowanceValue === 0n);
  const needErcApproval = side === "SELL" && !erc1155Approved;

  const fmt = (value: bigint | undefined, decimals = 6) => (value !== undefined ? Number(formatUnits(value, decimals)).toFixed(2) : "--");

  useEffect(() => {
    let cancelled = false;
    async function loadBestPrices() {
      const [yesBook, noBook] = await Promise.allSettled([fetchOrderbook(yesToken), fetchOrderbook(noToken)]);
      if (cancelled) return;
      if (yesBook.status === "fulfilled") {
        setYesBest({
          bid: yesBook.value.bids[0]?.price || 0.5,
          ask: yesBook.value.asks[0]?.price || yesBook.value.bids[0]?.price || 0.5,
        });
      }
      if (noBook.status === "fulfilled") {
        setNoBest({
          bid: noBook.value.bids[0]?.price || 0.5,
          ask: noBook.value.asks[0]?.price || noBook.value.bids[0]?.price || 0.5,
        });
      }
    }
    loadBestPrices();
    const interval = window.setInterval(loadBestPrices, 2500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [noToken, yesToken]);

  useEffect(() => {
    const next = side === "BUY" ? best.ask : best.bid;
    setPrice(next.toFixed(2));
  }, [best.ask, best.bid, side, token]);

  async function ensureAuth(): Promise<ApiCreds> {
    if (!address) throw new Error("Connect wallet first");
    return ensureApiCreds(address, signTypedDataAsync);
  }

  async function loadOpenOrders() {
    if (!address) return;
    setOrdersLoading(true);
    try {
      await ensureAuth();
      setOrders(onlyLiveOrders(await fetchOpenOrders(address), yesToken, noToken));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Could not load orders");
    } finally {
      setOrdersLoading(false);
    }
  }

  async function approve(type: "usdc" | "erc1155") {
    setLoading(true);
    setStatus(null);
    try {
      if (type === "usdc") {
        setStatus("Approving USDC");
        await writeContractAsync({ address: USDC_ADDRESS, abi: USDC_ABI, functionName: "approve", args: [EXCHANGE_ADDRESS, maxUint256] });
        setStatus("USDC approved");
      } else {
        setStatus("Approving outcome tokens");
        await writeContractAsync({ address: CTF_ADDRESS, abi: CTF_ABI, functionName: "setApprovalForAll", args: [EXCHANGE_ADDRESS, true] });
        setStatus("Outcome tokens approved");
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setLoading(false);
    }
  }

  async function placeOrder() {
    if (!address) return;
    if (numericPrice <= 0 || numericPrice >= 1) {
      setStatus("Price must be between 0 and 1");
      return;
    }
    if (numericSize <= 0) {
      setStatus("Shares must be greater than zero");
      return;
    }

    setLoading(true);
    setStep(0);
    setStatus(null);
    try {
      await ensureAuth();
      setStep(1);

      const makerAmount = side === "BUY" ? BigInt(Math.round(numericPrice * numericSize * 1e6)) : BigInt(Math.round(numericSize * 1e6));
      const takerAmount = side === "BUY" ? BigInt(Math.round(numericSize * 1e6)) : BigInt(Math.round(numericPrice * numericSize * 1e6));
      const salt = BigInt(Date.now());
      const order = {
        salt,
        maker: address as `0x${string}`,
        signer: address as `0x${string}`,
        taker: "0x0000000000000000000000000000000000000000" as `0x${string}`,
        tokenId: BigInt(tokenId),
        makerAmount,
        takerAmount,
        expiration: 0n,
        nonce: 0n,
        feeRateBps: 0n,
        side: side === "BUY" ? 0 : 1,
        signatureType: 0,
      };

      const signature = await signTypedDataAsync({
        domain: { name: "CTFExchange", version: "1", chainId: CHAIN_ID, verifyingContract: EXCHANGE_ADDRESS },
        types: {
          Order: [
            { name: "salt", type: "uint256" },
            { name: "maker", type: "address" },
            { name: "signer", type: "address" },
            { name: "taker", type: "address" },
            { name: "tokenId", type: "uint256" },
            { name: "makerAmount", type: "uint256" },
            { name: "takerAmount", type: "uint256" },
            { name: "expiration", type: "uint256" },
            { name: "nonce", type: "uint256" },
            { name: "feeRateBps", type: "uint256" },
            { name: "side", type: "uint8" },
            { name: "signatureType", type: "uint8" },
          ],
        },
        primaryType: "Order",
        message: { ...order, side: order.side as any, signatureType: order.signatureType as any },
      });

      setStep(2);
      await writeContractAsync({
        address: EXCHANGE_ADDRESS,
        abi: EXCHANGE_ABI,
        functionName: "registerOrder",
        args: [{ ...order, signature }],
      });

      setStep(3);
      const result = await postOrder({
        salt: salt.toString(),
        maker: address,
        signer: address,
        taker: "0x0000000000000000000000000000000000000000",
        tokenId,
        makerAmount: makerAmount.toString(),
        takerAmount: takerAmount.toString(),
        expiration: "0",
        nonce: "0",
        feeRateBps: "0",
        side,
        signatureType: 0,
        signature,
      });
      if (result.error) throw new Error(result.error);
      setStatus("Order placed");
      await loadOpenOrders();
      window.setTimeout(() => {
        void loadOpenOrders();
      }, 1600);
    } catch (err) {
      setStatus(err instanceof Error ? err.message.slice(0, 140) : "Order failed");
    } finally {
      setStep(-1);
      setLoading(false);
    }
  }

  async function cancelOpenOrder(orderId: string) {
    setOrdersLoading(true);
    try {
      await ensureAuth();
      const result = await cancelOrder(orderId);
      if (result.error) throw new Error(result.error);
      setOrders((current) => current.filter((order) => getOrderId(order) !== orderId));
      setStatus("Order cancelled");
    } catch (err) {
      setStatus(err instanceof Error ? err.message : "Cancel failed");
    } finally {
      setOrdersLoading(false);
    }
  }

  if (!address) {
    return (
      <div className="ticket">
        <div className="ticket-section" style={{ textAlign: "center" }}>
          <div className="empty-visual" style={{ margin: "4px auto 14px" }}>P</div>
          <h2 style={{ margin: "0 0 6px", fontSize: 18 }}>Connect wallet</h2>
          <p className="status-text">Connect to place signed orders against the local CLOB.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="ticket">
      <div className="ticket-section">
        <div className="ticket-title-row" style={{ marginBottom: 12 }}>
          <strong style={{ fontSize: 17 }}>Trade</strong>
          <span className="subtle">Best {side === "BUY" ? cents(best.ask) : cents(best.bid)}</span>
        </div>
        <div className="segmented">
          {(["BUY", "SELL"] as Side[]).map((item) => (
            <button key={item} className={side === item ? "active" : ""} type="button" onClick={() => setSide(item)}>
              {item === "BUY" ? "Buy" : "Sell"}
            </button>
          ))}
        </div>
      </div>

      <div className="ticket-section">
        <div className="outcome-select">
          {(["YES", "NO"] as Token[]).map((item) => {
            const selected = token === item;
            const itemBest = item === "YES" ? yesBest : noBest;
            return (
              <button key={item} className={`outcome-button ${item.toLowerCase()} ${selected ? "active" : ""}`} type="button" onClick={() => setToken(item)}>
                <span>{item}</span>
                <strong>{cents(side === "BUY" ? itemBest.ask : itemBest.bid)}</strong>
              </button>
            );
          })}
        </div>
      </div>

      <div className="ticket-section" style={{ display: "grid", gap: 12 }}>
        <div className="balance-grid">
          <div className="balance-cell">
            <span>USDC</span>
            <strong className="mono">{fmt(usdcBal as bigint | undefined)}</strong>
          </div>
          <div className="balance-cell">
            <span>YES</span>
            <strong className="mono">{fmt(yesBal as bigint | undefined)}</strong>
          </div>
          <div className="balance-cell">
            <span>NO</span>
            <strong className="mono">{fmt(noBal as bigint | undefined)}</strong>
          </div>
        </div>

        <div className="field">
          <label htmlFor="ticket-price">Limit price</label>
          <input id="ticket-price" className="ticket-input mono" type="number" min="0.01" max="0.99" step="0.01" value={price} onChange={(event) => setPrice(event.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="ticket-size">Shares</label>
          <input id="ticket-size" className="ticket-input mono" type="number" min="0" step="1" value={size} onChange={(event) => setSize(event.target.value)} />
        </div>

        <div className="estimate-grid">
          <div className="estimate-cell">
            <span>Total</span>
            <strong className="mono">${total.toFixed(2)}</strong>
          </div>
          <div className="estimate-cell">
            <span>Payout</span>
            <strong className="mono">${maxPayout.toFixed(2)}</strong>
          </div>
          <div className="estimate-cell">
            <span>{side === "BUY" ? "To win" : "Proceeds"}</span>
            <strong className="mono">${potentialProfit.toFixed(2)}</strong>
          </div>
        </div>

        {needUsdcApproval && (
          <button className="pm-button primary" type="button" disabled={loading} onClick={() => approve("usdc")}>
            Approve USDC
          </button>
        )}
        {needErcApproval && (
          <button className="pm-button primary" type="button" disabled={loading} onClick={() => approve("erc1155")}>
            Approve shares
          </button>
        )}

        {loading && step >= 0 && (
          <div className="progress-track">
            {STEPS.map((item, index) => (
              <span key={item} className={index <= step ? "active" : ""} />
            ))}
          </div>
        )}

        <button className={`pm-button ${side === "BUY" ? "green" : "red"}`} type="button" disabled={loading || needUsdcApproval || needErcApproval} onClick={placeOrder}>
          {loading && step >= 0 ? `${STEPS[step]}...` : `${side === "BUY" ? "Buy" : "Sell"} ${token}`}
        </button>

        {status && <div className={`alert ${status.includes("placed") || status.includes("approved") || status.includes("cancelled") ? "success" : "error"}`}>{status}</div>}
      </div>

      <div className="ticket-section">
        <div className="ticket-title-row" style={{ marginBottom: 10 }}>
          <strong>Open orders</strong>
          <button className="small-link" type="button" disabled={ordersLoading} onClick={loadOpenOrders}>
            {ordersLoading ? "Loading" : "Refresh"}
          </button>
        </div>
        <div className="orders-list">
          {orders.length === 0 ? (
            <p className="status-text">No open orders loaded.</p>
          ) : (
            orders.slice(0, 5).map((order) => {
              const orderId = getOrderId(order);
              const tokenIdForOrder = getOrderTokenId(order);
              return (
              <div className="order-row" key={orderId || `${order.maker}-${order.side}-${order.makerAmount}-${order.takerAmount}`}>
                <div className="ticket-line">
                  <strong>{order.side} {tokenIdForOrder === yesToken ? "YES" : "NO"}</strong>
                  <span className="mono">{Math.round(getOrderPrice(order) * 100)}c</span>
                </div>
                <div className="ticket-line">
                  <span className="mono">{orderId ? shortOrderId(orderId) : "Pending"}</span>
                  <button className="small-link" type="button" disabled={!orderId} onClick={() => cancelOpenOrder(orderId)}>
                    Cancel
                  </button>
                </div>
              </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
