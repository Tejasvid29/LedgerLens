# LedgerLens — Build Slices

One slice per session. `/clear` between them. Each is scoped to end in a single commit. Run `npm test` before committing.

Prompts are deliberately terse — Claude Code reads `CLAUDE.md` and the codebase itself. Restating context you've already written down is pure token tax.

## Phase 0 — Capture the baseline (do this first, it expires)

**S0 · (no Claude needed — do this yourself)**
Load the dashboard 20× against a wallet with 100+ txs, cache disabled, hitting Alchemy live. Chrome DevTools → Performance. Record the median. Screenshot to `docs/benchmarks/before.png`. Commit.

Once caching lands, this number cannot be recovered.

## Phase 1 — Chain ingest

**S1 · Sonnet**
Add an Alchemy client in `apps/api` for Ethereum only. Fetch asset transfers for an address, both directions, paginated. Types only — no DB writes yet.

**S2 · Opus**
Port the normalizer from the scaffold into `apps/api`. Then extend the test suite to cover: missing decimal metadata, decimal-as-hex vs decimal-as-int, a token reporting 0 decimals, negative/zero values, and reorg duplicates across pages.

Opus here because the edge cases are where silent corruption lives.

**S3 · Sonnet**
Wire the normalizer to Prisma. Upsert on `(chainId, hash, walletId)`. Add a sync service that fetches, normalizes, and persists for one wallet on one chain.

**S4 · Sonnet**
Extend sync to all 6 chains. Run chains concurrently with a bounded pool. Partial failure must not fail the whole sync — collect per-chain errors.

**S5 · Sonnet**
Add the holdings endpoint: aggregate current balances per token per chain from stored transactions. Tests for the aggregation math.

## Phase 2 — Cache

**S6 · Opus**
Port the cache service from the scaffold. Decide TTL and freshness windows per key type and explain the reasoning before writing code.

**S7 · Sonnet**
Put the cache in front of the holdings and transactions endpoints. Add `GET /metrics` exposing hit rate and per-layer latency.

**S8 · (yourself)**
Re-run the 20× measurement, cache warm. `docs/benchmarks/after.png`. Update the README with both numbers and the methodology.

## Phase 3 — Web

**S9 · Sonnet**
Build the dashboard shell in `apps/web` per the CLAUDE.md design tokens. Ledger-paper: hairline rules, tabular-nums, decimal alignment. Server components where possible. Empty and loading states included.

**S10 · Sonnet**
Wallet add/remove flow. Address validation with a clear error message on malformed input.

**S11 · Sonnet**
Transaction table: chain filter, token filter, pagination, sortable columns. Direction as ledger green/oxblood.

**S12 · Sonnet**
NextAuth with Google + email magic link. Wallets scoped to the authed user.

## Phase 4 — Insights

**S13 · Sonnet**
Insight generation service. Provider behind an interface — no direct coupling. Prompt must instruct the model to use only figures present in the input.

**S14 · Opus**
Port the eval harness from the scaffold. Write 15 eval cases covering: empty wallet, single transaction, 200+ transactions, one chain, all six chains, and a wallet holding spam tokens. Report grounding and coverage.

**S15 · Sonnet**
Semantic caching for insights using the scaffold's key function. Log token usage per request. Measure spend with cache off vs on over the same request set and record the delta.

## Phase 5 — Ship

**S16 · Sonnet**
GitHub Actions: install, lint, Jest, build both apps. Fail on any red.

**S17 · Sonnet**
Playwright e2e: add a wallet, sync, see transactions, generate an insight.

**S18 · (mostly yourself)**
Deploy. Vercel for web, Railway or AWS ECS for API + Postgres + Redis. Sentry. Put the live URL in the README and the GitHub repo description.

**S19 · Sonnet**
Rewrite the README as engineering documentation: architecture, design decisions, benchmark results with methodology, local setup. No mention of resumes or job applications.

## Getting users

Not a code task, and the one most likely to get skipped. After S18: SJSU Discords, r/ethdev, r/ethfinance, Show HN, crypto Twitter. Target 40. Screenshot your analytics — that's the number for the resume.
