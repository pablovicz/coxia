# syntax=docker/dockerfile:1
# Build a partir da raiz do monorepo: docker build -f apps/ai/Dockerfile .
FROM python:3.13-slim AS base
COPY --from=ghcr.io/astral-sh/uv:0.13.7 /uv /uvx /bin/
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PROJECT_ENVIRONMENT=/opt/venv \
    PATH=/opt/venv/bin:$PATH \
    FIXTURES_DIR=/fixtures
WORKDIR /app
COPY apps/ai/pyproject.toml apps/ai/uv.lock ./

# ---------- dev: hot reload, dependências de teste ----------
FROM base AS dev
RUN uv sync --frozen
COPY packages/contracts/schemas /app/schemas
COPY tests/fixtures /fixtures
COPY apps/ai/ ./
ENV COXIA_FIXTURES_DIR=/fixtures COXIA_SCHEMAS_DIR=/app/schemas
EXPOSE 8000
CMD ["uvicorn", "coxia_ai.main:app_factory", "--factory", "--host", "0.0.0.0", "--port", "8000", "--reload"]

# ---------- runtime: só dependências de produção, usuário sem privilégios ----------
FROM base AS runtime
RUN uv sync --frozen --no-dev
COPY tests/fixtures /fixtures
COPY apps/ai/coxia_ai ./coxia_ai
USER nobody
EXPOSE 8000
# Socket dual-stack (IPv4 + IPv6) na porta $PORT: ver coxia_ai/serve.py.
CMD ["python", "-m", "coxia_ai.serve"]
