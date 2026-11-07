# syntax=docker/dockerfile:1
# Build a partir da raiz do monorepo: docker build -f apps/api/Dockerfile .
# Estágios: dev (docker compose, hot reload) e runtime (último, usado pelo Railway).
FROM node:22-bookworm-slim AS base
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && npm install -g --silent pnpm@10.12.1
ENV CI=true PNPM_HOME=/pnpm TURBO_TELEMETRY_DISABLED=1
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY packages/config/package.json packages/config/
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
COPY packages/database/package.json packages/database/
COPY packages/domain/package.json packages/domain/
COPY apps/api/package.json apps/api/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@coxia/api..."

FROM deps AS source
COPY packages packages
COPY apps/api apps/api

# ---------- dev ----------
FROM source AS dev
RUN pnpm turbo run build --filter="@coxia/api^..."
ENV NODE_ENV=development
EXPOSE 3000
CMD ["pnpm", "turbo", "run", "dev", "--filter=@coxia/api...", "--only", "--ui=stream"]

# ---------- runtime ----------
FROM source AS build
RUN pnpm turbo run build --filter="@coxia/api..."

FROM build AS runtime
ENV NODE_ENV=production
USER node
EXPOSE 3000
# As migrations rodam no preDeploy do Railway: pnpm --filter @coxia/database db:deploy
CMD ["node", "apps/api/dist/main.js"]
