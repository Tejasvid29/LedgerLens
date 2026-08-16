# Built from the repo root (see docs/deploy.md and package.json's
# "docker:build" script) — npm workspaces need the whole monorepo's
# package.json files present to resolve package-lock.json consistently,
# not just apps/api's.
#
#   docker build -f apps/api/Dockerfile -t ledgerlens-api .

# ---- deps + build ----
FROM node:22-alpine AS build
WORKDIR /repo

# Prisma's query engine needs OpenSSL on Alpine — missing this produces a
# cryptic "Unable to require libquery_engine" failure at runtime, not at
# build time, which is a much worse place to discover it.
RUN apk add --no-cache openssl libc6-compat

# Workspace package.json files only, first — every workspace member must
# be present for `npm ci` to validate package-lock.json, but this layer
# only invalidates when a package.json actually changes, not on every
# source edit.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/e2e/package.json apps/e2e/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN npm ci

COPY . .

RUN npm run build -w @ledgerlens/shared
RUN npx prisma generate --schema apps/api/prisma/schema.prisma
RUN npm run build -w @ledgerlens/api

# Strips devDependencies across every workspace (typescript, jest,
# @nestjs/cli, eslint, apps/web's and apps/e2e's deps entirely — none of
# it runs in this image) after the build artifacts that needed them
# already exist. @prisma/client's generated engine in node_modules/.prisma
# is a regular dependency of @prisma/client, not a devDependency, so this
# doesn't touch it.
RUN npm prune --omit=dev

# ---- runtime ----
FROM node:22-alpine AS runtime
WORKDIR /app

RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production

# Preserves the same repo-relative layout as the build stage —
# node_modules/@ledgerlens/shared is a workspace symlink to
# ../../packages/shared, so packages/shared/dist has to exist at that same
# relative path here for it to resolve.
COPY --from=build /repo/node_modules ./node_modules
COPY --from=build /repo/package.json ./package.json
COPY --from=build /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=build /repo/packages/shared/dist ./packages/shared/dist
COPY --from=build /repo/apps/api/package.json ./apps/api/package.json
COPY --from=build /repo/apps/api/dist ./apps/api/dist
COPY --from=build /repo/apps/api/prisma ./apps/api/prisma

WORKDIR /app/apps/api

# Migrations are a separate deploy step (see docs/deploy.md), not run on
# container boot — running `prisma migrate deploy` from every task that
# happens to start (autoscaling, a rolling deploy with several tasks
# starting near-simultaneously) is a race a one-off migration step avoids
# entirely, and it matches how CI already runs it as its own step.
EXPOSE 3001
CMD ["node", "dist/main"]
