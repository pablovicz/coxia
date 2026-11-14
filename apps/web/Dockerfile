# syntax=docker/dockerfile:1
# Build a partir da raiz do monorepo: docker build -f apps/web/Dockerfile --build-arg VITE_API_URL=... .
FROM node:22-bookworm-slim AS base
RUN npm install -g --silent pnpm@10.12.1
ENV CI=true PNPM_HOME=/pnpm
WORKDIR /repo

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter "@coxia/web"

# ---------- dev ----------
FROM deps AS dev
COPY apps/web apps/web
EXPOSE 5173
CMD ["pnpm", "--filter", "@coxia/web", "dev"]

# ---------- build estático ----------
FROM deps AS build
ARG VITE_API_URL
ENV VITE_API_URL=${VITE_API_URL}
COPY apps/web apps/web
RUN test -n "$VITE_API_URL" || (echo "VITE_API_URL é obrigatório no build" && exit 1) \
 && pnpm --filter @coxia/web build

# ---------- runtime: nginx servindo a SPA ----------
FROM nginx:1.27-alpine AS runtime
ENV PORT=8080
COPY apps/web/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
