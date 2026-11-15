# syntax=docker/dockerfile:1
# Site público casakaju.com (Next.js standalone, com ISR: as salas da Coxia entram sozinhas).
# Build a partir da raiz do monorepo: docker build -f apps/site/Dockerfile --build-arg NEXT_PUBLIC_API_URL=... .
FROM node:22-bookworm-slim AS base
RUN npm install -g --silent pnpm@10.12.1
ENV CI=true PNPM_HOME=/pnpm NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/site/package.json apps/site/
RUN pnpm install --frozen-lockfile --filter "@coxia/site"

# ---------- build (apps/site/.next/standalone) ----------
FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY apps/site apps/site
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL é obrigatório no build" && exit 1) \
 && pnpm --filter @coxia/site build

# ---------- runtime: só o servidor rastreado pelo Next ----------
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=8080 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/site/.next/standalone ./
COPY --from=build --chown=node:node /repo/apps/site/.next/static ./apps/site/.next/static
COPY --from=build --chown=node:node /repo/apps/site/public ./apps/site/public
USER node
EXPOSE 8080
CMD ["node", "apps/site/server.js"]
