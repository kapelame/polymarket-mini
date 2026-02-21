"use client";
import dynamic from "next/dynamic";
import MarketHeader from "../components/MarketHeader";

const PriceChart   = dynamic(() => import("../components/PriceChart"),   { ssr: false });
const OrderBook    = dynamic(() => import("../components/OrderBook"),     { ssr: false });
const OrderForm    = dynamic(() => import("../components/OrderForm"),     { ssr: false });
const TradeHistory = dynamic(() => import("../components/TradeHistory"),  { ssr: false });

export default function Home() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <MarketHeader />

      <div style={{
        flex: 1, overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "260px 1fr 300px",
        gridTemplateRows: "auto 1fr",
        gap: 12, padding: 12,
      }}>
        {/* Price chart — spans top 2 columns */}
        <div style={{ gridColumn: "1 / 3" }}>
          <PriceChart />
        </div>

        {/* Order form — right column, spans both rows */}
        <div style={{ gridColumn: 3, gridRow: "1 / 3", overflowY: "auto" }}>
          <OrderForm />
        </div>

        {/* Order book — left */}
        <div style={{ gridColumn: 1, overflowY: "auto" }}>
          <OrderBook />
        </div>

        {/* Trade history — center */}
        <div style={{ gridColumn: 2, overflowY: "auto" }}>
          <TradeHistory />
        </div>
      </div>
    </div>
  );
}
