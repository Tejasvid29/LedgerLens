# Deploying LedgerLens

Web app → Vercel. API + Postgres + Redis → Railway. Errors → Sentry.

Everything in this repo (Dockerfile, env var wiring) is prepared and verified locally. The steps below need your own accounts, credentials, and dashboards — nobody else can do these for you, which is why S18 in `SLICES.md` calls this slice "(mostly yourself)".

Originally scoped for AWS ECS — the Dockerfile and ECS task definition still exist and still work (see the appendix), but for a project whose goal is "a live link, quickly," Railway gets there in minutes instead of hours with near-zero infrastructure debugging, for a few dollars a month instead of $50–100+. Same container, same image, much less surface area to get wrong.

## Prerequisites

- A Vercel account, connected to this GitHub repo.
- A Railway account, connected to this GitHub repo.
- A Sentry account (free tier is fine to start).
- The repo pushed to GitHub already (it is).

---

## Part 1 — Web app on Vercel

1. In the Vercel dashboard: **Add New → Project**, import this GitHub repo.
2. **Root Directory**: leave as the repo root (not `apps/web`) — `vercel.json` at the root already sets the build/install/output commands for the monorepo layout. Vercel should auto-detect the framework as Next.js from `vercel.json`.
3. Before the first deploy, set these **Environment Variables** in the Vercel project settings (Production — and Preview if you want preview deploys to work too, though they'll need their own OAuth redirect URI):

   | Variable | Value |
   |---|---|
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | from Google Cloud Console (see step 4) |
   | `NEXTAUTH_SECRET` | `openssl rand -base64 32` |
   | `NEXTAUTH_URL` | your Vercel production URL, e.g. `https://ledgerlens.vercel.app` |
   | `API_AUTH_SECRET` | must match the API's `API_AUTH_SECRET` exactly (Part 2) |
   | `API_URL` | the API's public URL (you won't have this until after Part 2 — deploy web first with a placeholder, come back and update it) |
   | `NEXT_PUBLIC_SENTRY_DSN` | from Sentry (Part 3), optional |

   See `apps/web/.env.local.example` for what each of these does.

4. Google Cloud Console → **APIs & Services → Credentials** → your OAuth 2.0 Client → add an **Authorized redirect URI**:
   ```
   https://<your-vercel-domain>/api/auth/callback/google
   ```
   (Keep the `localhost:3000` one too, for local dev.) If this is a new OAuth client, also configure the consent screen and add yourself as a test user under **Audience** while it's in Testing mode.

5. Deploy. Vercel will build with `npm run build -w @ledgerlens/shared && npm run build -w @ledgerlens/web` (from `vercel.json`) and serve from `apps/web/.next`.

---

## Part 2 — API + Postgres + Redis on Railway

### 2.1 — Create the project

1. [railway.app](https://railway.app) → **New Project** → **Deploy from GitHub repo** → pick this repo.
2. Railway will try to auto-detect a service from the repo root — delete that first guess if it picks the wrong thing; you want one service pointed specifically at the API.
3. The builder is pinned in code, not in the dashboard: `railway.json` at the repo root sets `build.builder: "DOCKERFILE"` and `build.dockerfilePath: "apps/api/Dockerfile"`. Railway's config-as-code always overrides dashboard/Railpack auto-detection, so no manual "Settings → Build" step is needed — the service just needs to exist and be connected to this repo. Root Directory should stay at its default (repo root) since the Dockerfile's build context needs the whole monorepo's `package.json` files, not just `apps/api`'s (see the Dockerfile's own comments).
4. **Settings → Networking** → note the public domain Railway assigns (or add a custom one) — this is your API's public URL, used as `API_URL` in Vercel and as the redirect target nowhere else (the API has no redirect-based auth, only the signed-token scheme from S12).

### 2.2 — Add Postgres and Redis

1. In the same Railway project: **New → Database → Add PostgreSQL**, and separately **New → Database → Add Redis**.
2. On the API service: **Variables** tab → reference the database services directly rather than copy-pasting connection strings:
   ```
   DATABASE_URL=${{Postgres.DATABASE_URL}}
   REDIS_URL=${{Redis.REDIS_URL}}
   ```
   Railway resolves these automatically and keeps them in sync if a database ever gets redeployed — a pasted-in connection string wouldn't.

### 2.3 — The rest of the API service's env vars

Still on the API service's **Variables** tab:

| Variable | Value |
|---|---|
| `ALCHEMY_API_KEY` | from [dashboard.alchemy.com](https://dashboard.alchemy.com) |
| `LLM_PROVIDER` | `openai` |
| `OPENAI_API_KEY` | from [platform.openai.com](https://platform.openai.com) — a separate account/billing from a ChatGPT subscription, see S14/S15 |
| `API_AUTH_SECRET` | must match Vercel's `API_AUTH_SECRET` exactly — `openssl rand -base64 32` |
| `CORS_ORIGIN` | your Vercel production URL from Part 1, e.g. `https://ledgerlens.vercel.app` |
| `PORT` | `3001` (Railway sets its own `PORT` by default for some builders, but since this is a Dockerfile build, the container's own `EXPOSE 3001`/`app.listen` wins — set this explicitly so Railway's health check hits the right port) |
| `SENTRY_DSN` | from Sentry (Part 3), optional |

Health check path is also pinned in `railway.json` (`deploy.healthcheckPath: "/health"`) — see `apps/api/src/health/health.controller.ts` — deliberately touches no dependency, so a momentary Postgres/Redis blip doesn't make Railway kill a healthy container. No dashboard step needed.

### 2.4 — Deploy, then run migrations once

1. Trigger the first deploy (Railway does this automatically once the service and its env vars are set).
2. Migrations aren't run on container boot (see the Dockerfile's comment on why — avoids multiple instances racing to migrate). Run them once, from your machine, against Railway's Postgres. `railway run` injects the linked service's env vars, but `DATABASE_URL` resolves to Postgres's *private* `postgres.railway.internal` hostname, which only works from inside Railway's network — not from your laptop. Use a tunnel instead, in two terminals:
   ```
   npm install -g @railway/cli   # if you don't have it
   railway login
   railway link                  # pick this project

   # terminal 1 — leave running
   railway connect Postgres --tunnel-only
   # prints a local host/port + the same credentials as DATABASE_URL

   # terminal 2 — use the printed local port
   DATABASE_URL="postgresql://postgres:<password>@127.0.0.1:<port>/railway" \
     npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
   ```
   This reaches Railway's Postgres over an encrypted tunnel without ever exposing the database publicly.
3. Future migrations: same command, any time you add one, before or right after pushing the schema change (Railway redeploys on every push to the connected branch automatically — there's no separate CD workflow to wire up here, unlike the AWS path).

---

## Part 3 — Sentry

1. Create a project in Sentry — one for the Next.js app (platform: Next.js), one for the API (platform: Node.js/NestJS). Two DSNs.
2. Web: set `NEXT_PUBLIC_SENTRY_DSN` in Vercel (Part 1, step 3). For source map upload, also set `SENTRY_AUTH_TOKEN` (Sentry → **Settings → Auth Tokens**), `SENTRY_ORG`, `SENTRY_PROJECT`. Without the auth token, error reporting still works — you just get minified stack traces instead of your actual source lines.
3. API: add `SENTRY_DSN` as a Railway variable (2.3).

---

## Part 4 — Close the loop

1. **Vercel**: update `API_URL` to the Railway domain from 2.1 step 4, redeploy.
2. **Railway**: confirm `CORS_ORIGIN` matches your actual Vercel domain exactly (scheme + host).

## Verification checklist

- [ ] `https://<vercel-domain>/login` loads and "Continue with Google" completes a real sign-in.
- [ ] Adding a wallet, syncing, and viewing transactions all work against the real API.
- [ ] Generating an insight succeeds (confirms `OPENAI_API_KEY` and `LLM_PROVIDER=openai` are correctly set in Railway).
- [ ] `https://<railway-domain>/health` returns `{"status":"ok"}`.
- [ ] Throwing a deliberate error surfaces in both Sentry projects.
- [ ] Pushing a change to `apps/api` actually redeploys on Railway automatically.

## Last step (per S18): publish the URLs

Once verified, put the live web URL in the README (S19 owns writing the README itself — add a "Live" line near the top once that exists) and in the GitHub repo's **About → Website** field.

---

## Appendix — AWS ECS (not currently used)

`apps/api/Dockerfile` builds the exact same image either way. `infra/ecs/task-definition.json` and `.github/workflows/deploy-api.yml` (manual `workflow_dispatch` trigger, so it's inert unless run deliberately) are a complete, ready-to-use alternative if this project ever needs to move onto AWS — for a job application specifically wanting AWS/ECS experience, or if this genuinely outgrows Railway's scale. Steps: install/configure the AWS CLI, provision RDS Postgres and ElastiCache Redis, store secrets in Secrets Manager, create an ECR repo and push the image, create two IAM roles (execution + task), stand up an ECS cluster/ALB/target group (health check path `/health`, port 3001), register `infra/ecs/task-definition.json`, run the first migration by hand, then add `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`/`PROD_DATABASE_URL` as GitHub repo secrets and run `deploy-api.yml` once manually before flipping it to deploy automatically on push.
