# syntax=docker/dockerfile:1
# Site público casakaju.com (Next.js, exportação estática servida pelo nginx).
# Build a partir da raiz do monorepo: docker build -f apps/site/Dockerfile --build-arg NEXT_PUBLIC_API_URL=... .
FROM node:22-bookworm-slim AS base
RUN npm install -g --silent pnpm@10.12.1
ENV CI=true PNPM_HOME=/pnpm NEXT_TELEMETRY_DISABLED=1
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/site/package.json apps/site/
RUN pnpm install --frozen-lockfile --filter "@coxia/site"

# ---------- build estático (apps/site/out) ----------
FROM deps AS build
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
COPY apps/site apps/site
RUN test -n "$NEXT_PUBLIC_API_URL" || (echo "NEXT_PUBLIC_API_URL é obrigatório no build" && exit 1) \
 && pnpm --filter @coxia/site build

# ---------- runtime: nginx servindo os arquivos ----------
FROM nginx:1.27-alpine AS runtime
ENV PORT=8080
COPY apps/site/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/site/out /usr/share/nginx/html
EXPOSE 8080
