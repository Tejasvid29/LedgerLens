# LedgerLens

Multi-chain crypto portfolio analytics. Give it a public wallet address, get back normalized holdings and transaction history across six EVM chains, plus an LLM-generated activity summary grounded in that specific wallet's data.

**Live:** [ledger-lens-api-2psb-theta.vercel.app](https://ledger-lens-api-2psb-theta.vercel.app) · API: [ledgerlens-production-4fc4.up.railway.app](https://ledgerlens-production-4fc4.up.railway.app)

Read-only. It never asks for a private key or a signature — an address is all it needs, because an address is all it uses.

---

## What it does

- Add any EVM address. It syncs Ethereum, Polygon, Arbitrum, Base, Optimism, and Avalanche in parallel and normalizes every transfer into one shape.
- Holdings are computed from the stored ledger, not a separate balance snapshot — the numbers on screen always agree with the transaction history underneath them.
- An LLM summarizes recent activity, constrained to only the figures actually present in that wallet's data (see [Grounded insights](#grounded-insights) below).
- A brand-new account gets a real, already-synced demo wallet automatically, instead of an empty screen.

## Architecture

```
apps/api      NestJS — chain sync, normalization, holdings, insights, auth
apps/web      Next.js 14 (App Router) — server-rendered dashboard
packages/shared   Types and pure functions shared by both (address validation,
                  amount formatting, service-token signing)
```

Postgres is the ledger of record; Redis is a cache in front of it, never the source of truth. Both apps are separately deployable — `apps/web` never talks to `apps/api` directly from the browser (see [Service-to-service auth](#service-to-service-auth)).

### Provider abstraction, used twice

Two different external dependencies — the chain data source and the LLM — sit behind the same shaped interface:

```ts
interface ChainProvider   { fetchTransactions(address, chain): Promise<NormalizedTransaction[]> }
interface InsightProvider { generateInsight(request): Promise<InsightResult> }
```

`AlchemyService` and `OpenAIInsightProvider` are the real implementations. Each also has a deterministic, offline counterpart — `FixtureChainProvider` and `StubInsightProvider` — selected by an env var (`CHAIN_PROVIDER`, `LLM_PROVIDER`), never by an `if (NODE_ENV === 'test')` scattered through business logic. The Playwright e2e suite runs against both fixtures: real UI, real HTTP calls between the two apps, zero live network calls, zero cost, fully deterministic.

`GroqInsightProvider` is a third `InsightProvider` — same interface, Groq's OpenAI-compatible free tier instead of OpenAI's billed one. Swapping providers is a one-line env var change; nothing upstream of the interface knows or cares which one is live.

### The normalizer

Every chain gives back a slightly different transfer shape, and Alchemy in particular reports token decimals inconsistently — sometimes a hex string (`"0x12"`), sometimes not. The normalizer is the one place that gets parsed defensively, tested against exactly the malformed inputs a live chain actually produces (missing decimals, negative/zero values, reorg duplicates across pages), and runs per-batch: one malformed transaction is collected as an error and skipped, never thrown, so it can't take a user's entire history down with it.

Token amounts are stored and passed around as strings, always paired with their `decimals`, and only ever converted to a display value at the last possible moment (`formatAmount()`). `0.1 + 0.2 !== 0.3` in floating point, and an 18-decimal token balance routinely exceeds `Number.MAX_SAFE_INTEGER` — so nothing in this codebase does arithmetic on a token amount as a JS number.

### Caching

Two independent staleness questions, kept deliberately separate:

- **Cache → DB.** How stale is the cached copy versus Postgres. Bounded by TTL (5 minutes for holdings/transactions), with a stale-while-revalidate window that serves the old value immediately while refreshing in the background.
- **DB → chain.** How stale is Postgres versus the chain itself. Bounded by *when the last sync ran*, not by TTL — a 60-second TTL and a 600-second TTL serve equally stale data if the last sync was 40 minutes ago. The API reports this staleness explicitly rather than silently masking it; syncing is a user decision, not something that happens invisibly on every page load and quietly burns Alchemy quota.

Redis failing degrades latency, never availability — every cache read/write is wrapped in a circuit breaker that opens after 3 consecutive failures and falls straight through to Postgres, logged but never thrown. A `Redis unreachable` warning in the logs means the app got slightly slower, not that it went down.

The insight cache is intentionally *not* stale-while-revalidate like the other two: a "background refresh" for a wallet balance is a free Postgres read, but for an insight it's a billed OpenAI request with no specific request to attribute its cost or failure to. So insight caching treats anything not fresh as a miss and only ever spends money inside a request that's actually waiting on the result. The cache key is content-addressed (a hash of the actual holdings/transactions being summarized), so a cache hit means "this exact data was already summarized," not "some time limit hasn't expired yet" — a wallet that hasn't changed keeps its cached summary indefinitely; one that has changed misses immediately, regardless of TTL.

Measured over the 15-case eval set, two passes each (a reload of the same wallet is the realistic case this exists for):

```
Cache OFF   30 provider calls   10,420 tokens
Cache ON    15 provider calls    5,210 tokens   (15 cache hits)
Delta       15 calls avoided     50.0% tokens saved
```

(`npm run measure:insight-spend -w @ledgerlens/api` — figures above are from the free stub provider, scaled by an estimated tokens-per-character ratio; rerun with `--provider=openai` against a funded account for real billed numbers.)

### Grounded insights

An LLM asked to summarize a wallet will happily also invent a number that sounds plausible. The prompt explicitly instructs the model to use only figures present in its input, and that input is a narrow, purpose-built shape (display strings, not raw base units or database rows) — the model physically cannot reach past what it's given to invent a figure from somewhere else.

This is checked, not just hoped for: 15 eval cases across seven categories (empty wallet, single transaction, 200+ transactions, one chain, all six chains, spam-token noise, decimal edge cases) run through a grounding grader that verifies every number in the model's output traces back to the input, and a coverage grader that checks the summary actually mentions the meaningful figures rather than being vague to stay safe.

```
TOTAL  15 cases   grounding 15/15 (100.0%)   avg coverage 100.0%
PASSED — every stated figure traces back to the input.
```

(`npm run evals -w @ledgerlens/api`)

### Service-to-service auth

`apps/web` never exposes the API's shared secret to the browser, and `apps/api` never touches NextAuth's session cookie directly — the two apps don't share a session mechanism at all. Instead, `apps/web`'s server signs a short-lived (60-second) token per request, scoped to the signed-in user's email, and `apps/api` verifies it. A client component (a form, a button) never calls the API directly; it calls a Next.js Server Action, which runs on the server, mints the token, and makes the call. This is also why the dashboard is a Server Component by default — sorting, filtering, and pagination are `<Link>` navigations that re-run the server fetch, not client-side state management.

## Problems hit during deployment, and what actually fixed them

Kept here instead of buried in commit history, because most of them weren't obvious from the error message alone.

**Railway silently ignored the Dockerfile.** Railway's default builder (Railpack) only auto-detects a `Dockerfile` at the exact repository root. This project's is at `apps/api/Dockerfile` (the build needs the whole monorepo's `package.json` files as context, not just one workspace's). A dashboard *Settings → Build* toggle for this doesn't exist in Railway's current UI, and a `RAILWAY_DOCKERFILE_PATH` service variable — Railway's own documented mechanism — didn't reliably take effect across several attempts. What actually worked: a committed `railway.json` at the repo root with `build.builder: "DOCKERFILE"` and an explicit `dockerfilePath` — config-as-code always overrides dashboard/variable settings, and unlike a dashboard toggle, it's version-controlled and can't silently drift.

**The API crashed on boot with no visible reason.** Health checks failed for several minutes before the container ever printed anything. Cause: Prisma's client connects eagerly in `onModuleInit()`, and `DATABASE_URL` wasn't set yet (Postgres hadn't been attached to the service). Nest's bootstrap rejected before `app.listen()` ever ran, so there was nothing for the health check to reach — not a health check bug, an eager-connect-with-missing-config bug that only *looked* like a networking problem.

**Then it crashed with the right env var and the right builder, for a third reason.** `PORT` wasn't set explicitly, and Railway auto-injects its own for every service. The app defaulted to `3001`, the public domain's target port was manually set to `3001` too, but Railway's actual assigned port was something else — so the proxy got `connection refused` even though the app was healthy and listening. Fixed by setting `PORT` explicitly rather than trusting the default to match whatever the platform decided.

**Migrations couldn't reach the database from a laptop.** Railway's `${{Postgres.DATABASE_URL}}` template resolves to a private network hostname (`postgres.railway.internal`), reachable only from inside Railway's own network — not from a developer's machine, regardless of how correct the connection string looks. Toggling the database's public networking on worked but meant briefly exposing it to the internet. `railway connect Postgres --tunnel-only` was the actual fix: an encrypted local tunnel to the same instance, no public exposure, works with any Postgres client.

**Vercel built the wrong app, from the wrong workspace.** A committed `vercel.json` sets a monorepo-aware build command (`shared` + `web` only, skipping the NestJS API entirely — Vercel has no reason to build it). It turned out that file existed on disk but had never actually been `git add`ed, so Vercel's clone never saw it and silently fell back to the root `package.json`'s generic `build` script, which built all three workspaces — including the API, which failed on an unrelated type error. The build log said "command failed," not "this config file doesn't exist where you think it does"; the fix was noticing the failing build was compiling `nest build` at all, which it had no reason to do.

**A model got deprecated between when the code was written and when it first ran in production.** Groq deprecated the Llama chat models this project was built against; the first live request 404'd with `model_not_found`. Fixed by switching to the current flagship model and adding a comment pointing at Groq's model list, since this will happen again.

**Two devices, "the same account," different data.** Wallets appeared to not sync across a phone and a laptop signed in with (supposedly) the same Google account. Direct database inspection settled it in one query: they were two different Google accounts (one a family member testing on the same device), not a bug in how wallets are scoped by user email. The lesson wasn't a code fix — it was that "I definitely signed in with the same account" is worth verifying against the actual data before debugging the auth code.

## Tech stack

**API** — NestJS 10, Prisma 6 / Postgres, ioredis / Redis, Alchemy SDK, Sentry
**Web** — Next.js 14 (App Router, Server Components + Server Actions), NextAuth (Google OAuth), Tailwind, Sentry
**Shared** — a small `packages/shared` workspace for types and pure functions used by both
**Testing** — Jest (291 unit/integration tests, API), Playwright (e2e, offline via fixture providers)
**Deploy** — Vercel (web), Railway (API + Postgres + Redis)

## Local development

```
cp .env.example .env
cp apps/web/.env.local.example apps/web/.env.local
# fill in Google OAuth credentials, an Alchemy key, and either GROQ_API_KEY or OPENAI_API_KEY

npm install
npm run db:up          # Postgres + Redis via docker-compose
npm run db:migrate
npm run dev             # both apps, concurrently
```

`CHAIN_PROVIDER=fixture` and `LLM_PROVIDER=stub` run the app fully offline against canned data — useful for UI work with zero API keys and zero cost. Never set either outside local dev or the e2e suite; production always wants the real thing.

## Testing

```
npm test                # apps/api — 291 tests
npm run test:e2e        # Playwright, offline via fixture + stub providers
npm run evals -w @ledgerlens/api           # insight grounding/coverage
npm run measure:insight-spend -w @ledgerlens/api   # cache spend delta
```

## Deployment

Vercel (web) and Railway (API + Postgres + Redis), both auto-deploying on push to `main`. Full runbook, including the AWS ECS path this project also supports but doesn't currently use, is in [`docs/deploy.md`](docs/deploy.md).
