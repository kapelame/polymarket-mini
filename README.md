# Polymarket Mini

A local Polymarket-style prediction market app with:

- Next.js trading UI
- Express CLOB server
- EIP-712 signed orders
- Local order books, open orders, cancellations, and fills
- Foundry contracts for a full Anvil setup

## Quick Start

```bash
npm run setup
npm run dev
```

Then open:

- UI: http://localhost:3001
- CLOB API: http://localhost:3000

The app starts in preview/dry-run mode when no `clob-server/.env` exists. You can browse the Polymarket-like UI immediately. Chain-backed market creation and signed order settlement require the full local chain setup below.

## Useful Commands

```bash
npm run dev        # run CLOB + UI together
npm run dev:clob   # run only the CLOB server
npm run dev:ui     # run only the Next.js UI on port 3001
npm run build      # build the UI
npm run check      # build UI and syntax-check server files
```

## Full Local Chain Setup

Start Anvil:

```bash
anvil
```

Deploy contracts from another terminal:

```bash
PRIVATE_KEY=<anvil-account-private-key> \
OPERATOR_ADDRESS=<operator-wallet-address> \
forge script script/Deploy.s.sol:Deploy --rpc-url http://localhost:8545 --broadcast
```

Copy the env template:

```bash
cp clob-server/.env.example clob-server/.env
```

Update `clob-server/.env` with the deployed `USDC_ADDRESS`, `CTF_ADDRESS`, `EXCHANGE_ADDRESS`, `ORACLE_ADDRESS`, and set `OPERATOR_KEY` to the operator private key.

Run everything:

```bash
npm run dev
```

## Notes

- Quick-start mode intentionally uses `OPERATOR_KEY=dry-run`; it is for fast UI review.
- Never commit real private keys or production secrets.
- The UI expects the CLOB API at `http://localhost:3000`.
