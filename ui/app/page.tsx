"use client";
import dynamic from "next/dynamic";
import MarketHeader from "../components/MarketHeader";

const PriceChart         = dynamic(() => import("../components/PriceChart"),         { ssr: false });
const OrderBook          = dynamic(() => import("../components/OrderBook"),           { ssr: false });
const OrderForm          = dynamic(() => import("../components/OrderForm"),           { ssr: false });
const TradeHistory       = dynamic(() => import("../components/TradeHistory"),        { ssr: false });
const BtcMarketCreator   = dynamic(() => import("../components/BtcMarketCreator"),   { ssr: false });

export default function Home() {
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh", overflow: "hidden" }}>
      <MarketHeader />

      <div style={{
        flex: 1, overflow: "auto",
        display: "grid",
        gridTemplateColumns: "260px 1fr 320px",
        gridTemplateRows: "auto auto 1fr",
        gap: 12, padding: 12,
      }}>
        {/* Price chart */}
        <div style={{ gridColumn: "1 / 3" }}>
          <PriceChart />
        </div>

        {/* Order form — right, spans all rows */}
        <div style={{ gridColumn: 3, gridRow: "1 / 4", overflowY: "auto", display: "flex", flexDirection: "column", gap: 12 }}>
          <OrderForm />
          <BtcMarketCreator />
        </div>

        {/* Order book */}
        <div style={{ gridColumn: 1, overflowY: "auto" }}>
          <OrderBook />
        </div>

        {/* Trade history */}
        <div style={{ gridColumn: 2, overflowY: "auto" }}>
          <TradeHistory />
        </div>
      </div>
    </div>
  );
}
