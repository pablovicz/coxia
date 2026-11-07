# syntax=docker/dockerfile:1
# Build a partir da raiz do monorepo: docker build -f apps/worker/Dockerfile .
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
COPY apps/worker/package.json apps/worker/
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter "@coxia/worker..."

FROM deps AS source
COPY packages packages
COPY apps/worker apps/worker

# ---------- dev ----------
FROM source AS dev
RUN pnpm turbo run build --filter="@coxia/worker^..."
ENV NODE_ENV=development
EXPOSE 3001
CMD ["pnpm", "turbo", "run", "dev", "--filter=@coxia/worker...", "--ui=stream"]

# ---------- runtime ----------
FROM source AS build
RUN pnpm turbo run build --filter="@coxia/worker..."

FROM build AS runtime
ENV NODE_ENV=production
USER node
EXPOSE 3001
CMD ["node", "apps/worker/dist/main.js"]
