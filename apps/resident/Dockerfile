# syntax=docker/dockerfile:1
# Workspace do residente (residente.casakaju.com).
# Build a partir da raiz do monorepo: docker build -f apps/resident/Dockerfile --build-arg VITE_API_URL=... .
FROM node:22-bookworm-slim AS base
RUN npm install -g --silent pnpm@10.12.1
ENV CI=true PNPM_HOME=/pnpm
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/resident/package.json apps/resident/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile --filter "@coxia/resident..."

# ---------- dev ----------
FROM deps AS dev
COPY packages/ui packages/ui
COPY apps/resident apps/resident
EXPOSE 5174
CMD ["pnpm", "--filter", "@coxia/resident", "dev"]

# ---------- build estático ----------
FROM deps AS build
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
COPY packages/ui packages/ui
COPY apps/resident apps/resident
RUN test -n "$VITE_API_URL" || (echo "VITE_API_URL é obrigatório no build" && exit 1) \
 && pnpm --filter @coxia/resident build

# ---------- runtime: nginx servindo a SPA ----------
FROM nginx:1.27-alpine AS runtime
ENV PORT=8080
COPY apps/resident/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/resident/dist /usr/share/nginx/html
EXPOSE 8080
