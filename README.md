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

The original plan was a pre-cache vs post-cache comparison, but the "before"
number was never captured ahead of the caching work landing, and per
`CLAUDE.md` it can't be regenerated after the fact. What's below instead is
a same-codebase A/B: cache bypassed vs cache warm, isolating just the
caching layer rather than conflating it with everything else that shipped
alongside it. Full protocol and raw results: [`docs/benchmarks/`](docs/benchmarks/).

1. **Cache off:** `GET /wallets/:id/transactions?nocache=true` × 20 — Redis bypassed, reads Postgres directly.
2. **Cache on:** `GET /wallets/:id/transactions` × 20 — Redis warm after the first request.

| Mode | Median | p95 |
|------|--------|-----|
| Cache off | _pending — see docs/benchmarks/_ | _pending_ |
| Cache on | _pending — see docs/benchmarks/_ | _pending_ |

Cache metrics: `GET http://localhost:3001/metrics` — reports hit rate plus per-layer latency (cache round-trip vs. origin/Postgres query time).

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
