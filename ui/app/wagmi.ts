import { createConfig, http } from "wagmi";
import { anvil } from "wagmi/chains";
import { injected, mock } from "wagmi/connectors";

const DEMO_ACCOUNT = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

export const config = createConfig({
  chains: [anvil],
  connectors: [
    injected(),
    mock({
      accounts: [DEMO_ACCOUNT],
      features: { reconnect: true },
    }),
  ],
  transports: {
    [anvil.id]: http("http://127.0.0.1:8545"),
  },
  ssr: false,
});
