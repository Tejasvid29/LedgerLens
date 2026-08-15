# Ledgerlens

Multi-chain crypto portfolio analytics. Connect a wallet address (read-only),
see holdings and transaction history normalized across chains.

## Architecture

```
Browser
   │
   ▼
Next.js (SSR dashboard)  ──────────┐
   │                               │
   ▼                               ▼
NestJS API  ◄──►  Redis      PostgreSQL
   │                               ▲
   ▼                               │
Chain Ingest (Alchemy) ────────────┘
   │
   ▼
Normalizer  ─►  unified Transaction schema
```

**Chains:** Ethereum, Polygon, Arbitrum, Base, Optimism, Avalanche (Alchemy-supported; BNB swapped for AVAX).

## Quick start

```bash
# 1. Copy env and add your Alchemy key
cp .env.example .env

# 2. Start Postgres + Redis
npm run db:up

# 3. Install dependencies
npm install

# 4. Run migrations
npm run db:migrate

# 5. Start dev servers (API :3001, Web :3000)
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), add a wallet address, click **Sync from chain**.

## Measurement protocol

1. **Before (baseline):** Load dashboard 20× with `?refresh=true` (bypasses cache, hits RPC). Record median page load in Chrome DevTools Performance.
2. **After:** Repeat with cache warm (default refresh). Screenshot both, add to this README.

Cache metrics: `GET http://localhost:3001/metrics`

## Project structure

```
apps/
  api/          NestJS — chain ingest, normalizer, cache, sync
  web/          Next.js 14 — ledger-paper dashboard UI
docker-compose.yml   Postgres + Redis
```

## Tests

```bash
npm test                    # Jest unit tests (normalizer)
npm run build               # Build both apps
```

## Design

Ledger-paper aesthetic: light background, hairline rules, tabular-nums on all figures. Green/red reserved for gain/loss only.

## License

MIT
