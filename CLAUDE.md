# LedgerLens

Multi-chain crypto portfolio analytics. Read-only wallet addresses → normalized holdings + transaction history across 6 EVM chains, with LLM-generated activity summaries.

Monorepo: `apps/api` (NestJS), `apps/web` (Next.js 14 App Router). Postgres + Redis via `docker-compose.yml`.

## Hard rules

1. Token amounts are strings, never numbers. Store base units as strings with `decimals` alongside. Convert only in `formatAmount()` at display time. `0.1 + 0.2 !== 0.3` and 18-decimal values exceed `Number.MAX_SAFE_INTEGER`.
2. Read-only. No signing, no private keys, ever. Address input only.
3. Cache fails open. Redis down → fall through to source. A cache outage degrades latency, not availability.
4. Normalizer collects errors, never throws on a batch. One malformed transaction must not lose a user their whole history.
5. Alchemy returns `rawContract.decimal` as a hex string (`"0x12"` = 18), inconsistently. Parse defensively. This bug is silent, not loud.
6. Addresses and tx hashes are lowercased before storage. Dedupe key is `(chainId, hash, walletId)` — upsert, never insert.

## Chains

Ethereum 1, Polygon 137, Arbitrum 42161, Base 8453, Optimism 10, Avalanche 43114.

## Design tokens

```
ink #14161A · paper #F5F6F4 · rule #D8DBD5
ledgerGreen #1F6F4A (gains only) · oxblood #A32C21 (losses only) · indigo #2B4C7E
Display: Inter Tight · Body: Inter · Data: IBM Plex Mono
```

Ledger-paper aesthetic: hairline rules, `font-variant-numeric: tabular-nums` on every figure, decimal alignment. Green/red carry meaning — never decorative. Copy: name things by what the user controls. Errors state what broke and how to fix it.

## Workflow

- One vertical slice per commit. Conventional commits (`feat:`, `fix:`, `test:`).
- Run `npm test` before every commit. Don't commit red.
- Don't touch `apps/*/dist`, `.next`, or `node_modules`.
- Ask before adding a dependency.

## Performance baseline (do not overwrite)

`docs/benchmarks/` holds before/after page-load measurements. The "before" number was captured pre-cache and is unrecoverable — never regenerate it.
