# Deploying LedgerLens

Web app → Vercel. API + Postgres + Redis → AWS (ECS Fargate, RDS, ElastiCache). Errors → Sentry.

Everything in this repo (Dockerfile, ECS task definition, GitHub Actions workflow, env var wiring) is prepared and verified locally. The steps below are the ones that need your own accounts, credentials, and dashboards — nobody else can do these for you, which is why S18 in `SLICES.md` calls this slice "(mostly yourself)".

## Prerequisites

- A Vercel account, connected to this GitHub repo.
- An AWS account with billing set up, and the AWS CLI configured locally (`aws configure`) with an IAM user that can create IAM roles, RDS/ElastiCache instances, ECR repos, and ECS resources.
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

## Part 2 — API + Postgres + Redis on AWS ECS

All commands below use the AWS CLI with your own credentials — replace `<ACCOUNT_ID>`, `<REGION>`, and the placeholder values throughout.

### 2.1 — RDS Postgres

```
aws rds create-db-instance \
  --db-instance-identifier ledgerlens-db \
  --db-instance-class db.t4g.micro \
  --engine postgres \
  --engine-version 16 \
  --master-username ledgerlens \
  --master-user-password '<choose-a-strong-password>' \
  --allocated-storage 20 \
  --publicly-accessible false \
  --vpc-security-group-ids <your-security-group-id>
```

Once available, your `DATABASE_URL` is:
```
postgresql://ledgerlens:<password>@<rds-endpoint>:5432/ledgerlens
```

### 2.2 — ElastiCache Redis

```
aws elasticache create-cache-cluster \
  --cache-cluster-id ledgerlens-redis \
  --engine redis \
  --cache-node-type cache.t4g.micro \
  --num-cache-nodes 1 \
  --security-group-ids <your-security-group-id>
```

`REDIS_URL` is `redis://<elasticache-endpoint>:6379`. Redis failing open (rule 3 — see `CLAUDE.md`) means a Redis outage degrades latency, not availability, so a single node here is a reasonable place to start.

### 2.3 — Secrets Manager

Store everything the task definition references as a secret (`infra/ecs/task-definition.json`'s `secrets` array), not a plaintext `environment` entry:

```
for name in DATABASE_URL REDIS_URL ALCHEMY_API_KEY OPENAI_API_KEY API_AUTH_SECRET SENTRY_DSN; do
  aws secretsmanager create-secret --name "ledgerlens/$name" --secret-string '<value>'
done
```

(Run it once per variable with the real value substituted — the loop above is illustrative, not literal copy-paste.)

### 2.4 — ECR repo + first image push

```
aws ecr create-repository --repository-name ledgerlens-api

aws ecr get-login-password --region <REGION> | \
  docker login --username AWS --password-stdin <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com

npm run docker:build:api
docker tag ledgerlens-api:latest <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/ledgerlens-api:latest
docker push <ACCOUNT_ID>.dkr.ecr.<REGION>.amazonaws.com/ledgerlens-api:latest
```

### 2.5 — IAM roles

Two roles, both referenced in `infra/ecs/task-definition.json`:
- **Execution role** (`ledgerlens-ecs-execution-role`): needs `AmazonECSTaskExecutionRolePolicy` plus `secretsmanager:GetSecretValue` on the `ledgerlens/*` secrets from 2.3 — this is what lets ECS itself pull the image and inject secrets at container start.
- **Task role** (`ledgerlens-ecs-task-role`): what the running application itself is allowed to do. Empty policy is fine to start — the app doesn't call any AWS APIs directly.

### 2.6 — ECS cluster, service, ALB

```
aws ecs create-cluster --cluster-name ledgerlens
```

Create an Application Load Balancer with a target group pointed at port 3001, health check path `/health` (see `apps/api/src/health/health.controller.ts` — deliberately dependency-free, see its comment for why). Then:

1. Fill in `infra/ecs/task-definition.json`'s `<ACCOUNT_ID>`, `<REGION>`, and `CORS_ORIGIN` (your Vercel domain from Part 1) placeholders.
2. Register it: `aws ecs register-task-definition --cli-input-json file://infra/ecs/task-definition.json`
3. Create the service, in the VPC/subnets your RDS and ElastiCache instances are in, attached to the ALB target group:
   ```
   aws ecs create-service \
     --cluster ledgerlens \
     --service-name ledgerlens-api \
     --task-definition ledgerlens-api \
     --desired-count 1 \
     --launch-type FARGATE \
     --network-configuration "awsvpcConfiguration={subnets=[<subnet-ids>],securityGroups=[<sg-id>],assignPublicIp=ENABLED}" \
     --load-balancers "targetGroupArn=<target-group-arn>,containerName=api,containerPort=3001"
   ```

### 2.7 — Run migrations once, manually, for the first deploy

```
DATABASE_URL='<your RDS DATABASE_URL>' npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

(After this, `.github/workflows/deploy-api.yml` runs this same command automatically on every deploy.)

### 2.8 — Wire up continuous deployment

In the GitHub repo's **Settings → Secrets and variables → Actions**, add:
- `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` — an IAM user scoped to ECR push + ECS deploy + the specific Secrets Manager entries.
- `PROD_DATABASE_URL` — same value as 2.1's `DATABASE_URL`, for the migration step.

Then run `.github/workflows/deploy-api.yml` manually once (**Actions** tab → **Deploy API to ECS** → **Run workflow**) to confirm the whole pipeline works end to end. Once you're confident, edit the workflow's `on:` trigger to deploy automatically on push to `main` (the comment at the top of the file shows exactly what to change).

---

## Part 3 — Sentry

1. Create a project in Sentry — one for the Next.js app (platform: Next.js), one for the API (platform: Node.js/NestJS). Two DSNs.
2. Web: set `NEXT_PUBLIC_SENTRY_DSN` in Vercel (Part 1, step 3). For source map upload, also set `SENTRY_AUTH_TOKEN` (Sentry → **Settings → Auth Tokens**), `SENTRY_ORG`, `SENTRY_PROJECT`. Without the auth token, error reporting still works — you just get minified stack traces instead of your actual source lines.
3. API: add `SENTRY_DSN` to Secrets Manager (2.3) with the API project's DSN, and it flows into the task definition automatically.

---

## Part 4 — Close the loop

Two values only become known after Part 2 finishes, and need to be set retroactively:

1. **Vercel**: update `API_URL` to the ALB's public URL (or a custom domain pointed at it), redeploy.
2. **`infra/ecs/task-definition.json`**: confirm `CORS_ORIGIN` matches your actual Vercel domain exactly (scheme + host, e.g. `https://ledgerlens.vercel.app`), re-register the task definition if you changed it after 2.6.

## Verification checklist

- [ ] `https://<vercel-domain>/login` loads and "Continue with Google" completes a real sign-in.
- [ ] Adding a wallet, syncing, and viewing transactions all work against the real API.
- [ ] Generating an insight succeeds (confirms `OPENAI_API_KEY` and `LLM_PROVIDER=openai` are correctly set in Secrets Manager).
- [ ] `https://<api-domain>/health` returns `{"status":"ok"}`.
- [ ] Throwing a deliberate error surfaces in both Sentry projects.
- [ ] `git commit`/push to `main` after flipping `deploy-api.yml`'s trigger actually redeploys the API.

## Last step (per S18): publish the URLs

Once verified, put the live web URL in the README (S19 owns writing the README itself — add a "Live" line near the top once that exists) and in the GitHub repo's **About → Website** field.
