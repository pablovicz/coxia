# Coxia

> **A inteligência por trás da cena.** Assistente operacional WhatsApp-first para casas culturais.
> Projeto-piloto: **Coxia · by Casa Kaju**.

Planejamento completo em [docs/PLANO_MVP.md](docs/PLANO_MVP.md) · identidade visual em [docs/DESIGN_SYSTEM.md](docs/DESIGN_SYSTEM.md).

## Estado atual — Etapas 1, 2 e 3

### Etapa 3 — projetos com IA (grupo do WhatsApp = workspace)

| Entregue | Onde |
|---|---|
| Ativação do workspace na primeira mensagem de quem coordena projetos, idempotente pelo ID do grupo (nunca pelo nome); aviso de privacidade e retenção no grupo; renomear o grupo preserva o projeto | `packages/domain/src/projects.ts`, `workspace.ts` |
| Briefing em áudio (ou "Briefing: …"): transcrição → briefing estruturado → tarefas propostas + confirmação no grupo | `workspace.ts`, `apps/worker` |
| Eventos extraídos pela IA e aplicados por **política explícita** (`decideEvent`): compromisso vira tarefa, sugestão vai para revisão, cotação nunca é pagamento, `paid` exige comprovante; "terminei X" conclui a tarefa | `projects.ts` |
| Sem duplicação: fingerprint por mensagem, comprovante único por organização (também contra contas mensais), pagamento casa com a despesa já lançada | `workspace.ts`, migration `etapa3_projects` |
| Encerramento: só quem coordena, prévia de pendências, "SIM" do mesmo participante, relatório salvo; expira em 30 min | `workspace.ts`, `ProjectService` |
| Check-in diário opcional no grupo (só com tarefa atrasada/vencendo) e pendências de projeto no briefing matinal | `notifications.ts`, `briefing.ts` |
| REST de projetos (revisão de tarefas, lançamentos e sugestões; encerramento) e painel com fila de revisão e evidência da mensagem de origem | `apps/api/src/domain`, `apps/web/src/features/projects` |

Cada evento grava mensagem de origem, autor, modelo, versão de prompt/parser e status de revisão; a IA recebe o **estado estruturado** do projeto e as últimas mensagens, nunca o histórico inteiro.

### Etapa 2 — agenda, contas, lembretes e briefing

| Entregue | Onde |
|---|---|
| Regras de negócio compartilhadas por api e worker (sem NestJS, testáveis isoladamente) | `packages/domain` |
| Reservas avulsas e semanais, horário de funcionamento, bloqueios, conflitos relatados por data, alterar/cancelar uma data ou a série | `packages/domain/src/bookings.ts` |
| Contas mensais: competência sem duplicidade, dia 31 → último dia, pagamento parcial/antecipado, comprovante duplicado, mudança de vencimento/valor, suspensão | `packages/domain/src/bills.ts` |
| Briefing matinal (texto gerado do estado estruturado), avisos D-1/no dia/atrasada com reaviso configurável, véspera e 1h antes da reserva, lembretes | `briefing.ts`, `notifications.ts` |
| Comandos de administradoras pelo WhatsApp (texto ou áudio): disponibilidade, reservar, cancelar com confirmação SIM, pagar conta com comprovante, resumo | `packages/domain/src/commands.ts`, `apps/worker` |
| REST: salas, reservas, disponibilidade, contas, pagamentos, lembretes, visão geral | `apps/api/src/domain` |
| Painel: agenda (dia no celular, semana no desktop), formulário com conflitos, contas do mês, pagamento, cadastro de contas e lembretes | `apps/web/src/features` |

Política anti-spam: quem recebe o briefing matinal vê nele as contas e reservas do dia; avisos avulsos vão só para os demais destinatários. Nada diário sai antes do horário do briefing.

### Etapa 1 — fundação

| Entregue | Onde |
|---|---|
| Monorepo pnpm + Turborepo, `uv` para Python | raiz, `apps/ai` |
| Modelo de dados completo do MVP + migrations com `EXCLUDE USING gist` (reservas sem sobreposição) e CHECKs | `packages/database` |
| Webhook Z-API: segredo na URL, normalização, deduplicação, persistência, fila | `apps/api/src/whatsapp` |
| `WhatsappProvider` (Z-API + fake) | `packages/shared/src/whatsapp` |
| Auth JWT + RBAC (`owner/admin/staff/viewer`), idempotência por `Idempotency-Key`, auditoria | `apps/api` |
| Worker: mídia → bucket (sha256), roteamento de mensagens, outbox com retries/dead-letter, reconciliação, checagem de conexão | `apps/worker` |
| Contratos API↔IA (zod ⇄ Pydantic + JSON Schema) e FastAPI com provedor determinístico e OpenAI | `packages/contracts`, `apps/ai` |
| SPA React com tokens, light/dark/system, navegação mobile/desktop | `apps/web` |
| Docker Compose (dev com hot reload) e compose de teste isolado | `docker-compose*.yml` |
| Railway IaC e CI | `.railway/railway.ts`, `.github/workflows/ci.yml` |

**Ainda não implementado:** estabilização (Etapa 4), incluindo a rotina que aplica a retenção de mensagens e anexos (`organizations.retention_days`, já informada no aviso do grupo). Comandos e projetos usam a IA real só com `AI_PROVIDER=openai`; com `fixture` (padrão local) as respostas vêm de `tests/fixtures/ai`. A **Etapa 0** (validação com instância Z-API real) continua pendente: as fixtures em `tests/fixtures/zapi` foram montadas a partir da documentação e estão marcadas em `manifest.json` para substituição por payloads reais.

## Arquitetura

```text
WhatsApp (Z-API) ──> api (NestJS) ──> PostgreSQL ◀── worker (NestJS/BullMQ) ──> ai (FastAPI) ──> OpenAI
                        │   ▲                              ▲      │
web (React SPA) ────────┘   └────────── Redis ─────────────┘      └──> bucket S3 (MinIO local)
```

- **IA interpreta; domínio decide.** O serviço `ai` não acessa o banco; devolve propostas tipadas que o NestJS valida.
- **Webhook rápido.** A api só normaliza, deduplica por `(provider, instância, messageId)`, grava e enfileira. Se o enfileiramento falhar, a reconciliação do worker reenvia.
- **Outbox.** Notificações são gravadas em `notification_deliveries` na mesma transação da mudança; o worker envia com `FOR UPDATE SKIP LOCKED`, backoff exponencial e dead-letter.

## Rodando localmente

Pré-requisitos: Node ≥ 20.17, pnpm 10, Docker, Python 3.12+ e [uv](https://docs.astral.sh/uv/).

```bash
cp .env.example .env          # ajuste POSTGRES_PORT se já houver um Postgres na 5432
pnpm install

# Opção A — tudo no Docker, com hot reload (migrations e seed rodam no serviço `migrate`)
docker compose up --build
#   web http://localhost:5173 · api http://localhost:3000 · ai http://localhost:8000 · MinIO console http://localhost:9001

# Opção B — só infraestrutura no Docker, apps no host
docker compose up -d postgres redis minio minio-init
pnpm db:deploy && pnpm db:seed   # com as variáveis do .env exportadas
pnpm dev
(cd apps/ai && uv sync && uv run uvicorn coxia_ai.main:app_factory --factory --reload)
```

O seed cria a organização Casa Kaju, as três salas, as contas fixas padrão, a instância de WhatsApp e — se `SEED_ADMIN_EMAIL`/`SEED_ADMIN_PASSWORD` estiverem definidos — a primeira administradora. Horários de funcionamento e dias de vencimento do seed são **placeholders**.

Para simular uma mensagem recebida (provider `fake`, aceita payloads no formato Z-API):

```bash
curl -X POST http://localhost:3000/webhooks/zapi/dev-webhook-secret-change-me \
  -H 'content-type: application/json' -d @tests/fixtures/zapi/text-group-first-message.json
```

## Testes

| Comando | O que roda |
|---|---|
| `pnpm test` | unitários + golden (normalizador Z-API, regras de data, contratos, roteamento, web) |
| `pnpm test:integration` | sobe `docker-compose.test.yml` (tmpfs, portas 55432/56379/59000), aplica migrations e roda as suítes de integração de database, api e worker |
| `pnpm test:ai` | pytest do FastAPI (contratos espelhados do zod, autenticação, fixtures determinísticas) |
| `pnpm test:visual` | Playwright no container Linux oficial: 390/1440px × light/dark, estados vazio/carregando/erro, interação por teclado |

### Golden tests

- Entradas em `tests/fixtures/`, saídas aprovadas em `tests/golden/` e `apps/web/e2e/__screenshots__/`.
- **Mudança de golden exige revisão**: os testes nunca regravam sozinhos. Para aprovar uma mudança intencional:
  - normalizador: `UPDATE_GOLDEN=1 pnpm --filter @coxia/shared test`
  - domínio (briefing, mensagens de projeto, política de eventos): `UPDATE_GOLDEN=1 pnpm --filter @coxia/domain test`
  - visual: `pnpm --filter @coxia/web test:visual:docker:update` (sempre no container, nunca no host)
  - e revise o diff no PR.
- Contratos API↔IA: depois de alterar `packages/contracts`, rode `pnpm contracts:export`; o CI falha se `packages/contracts/schemas` estiver desatualizado, e o pytest compara os campos obrigatórios com os modelos Pydantic.
- A IA real (OpenAI) não roda no CI; os testes usam `AI_PROVIDER=fixture` com respostas de `tests/fixtures/ai`.

## Deploy (Railway)

Infraestrutura declarada em [.railway/railway.ts](.railway/railway.ts): `api`, `worker`, `ai`, `web`, PostgreSQL, Redis e bucket.

1. Crie as variáveis compartilhadas do ambiente: `AI_SERVICE_TOKEN`, `ZAPI_INSTANCE_ID`, `ZAPI_INSTANCE_TOKEN`, `ZAPI_CLIENT_TOKEN`, `ZAPI_WEBHOOK_SECRET`; e os segredos por serviço `JWT_SECRET` (api) e `OPENAI_API_KEY` (ai).
2. Confirme `BUCKET_REGION` no arquivo.
3. `railway config plan` → revisar → `railway config apply`.
4. Configure o callback "ao receber" da Z-API para `https://<domínio da api>/webhooks/zapi/<ZAPI_WEBHOOK_SECRET>`.

Itens marcados "A CONFIRMAR" no topo do arquivo dependem da saída do primeiro `plan`.

## Estrutura

```text
apps/
  api/        NestJS — REST, webhooks, auth/RBAC, idempotência, auditoria
  worker/     NestJS — BullMQ: mensagens recebidas, outbox, reconciliação, conexão
  ai/         FastAPI — transcrição, extração estruturada, interpretação de comandos
  web/        React + Vite + Tailwind v4 (tokens do design system)
packages/
  config/     validação de variáveis de ambiente (zod)
  contracts/  schemas compartilhados (InboundMessage, contratos API↔IA, filas) + JSON Schema
  database/   Prisma schema, migrations, seed, outbox
  domain/     regras de negócio: salas, reservas, contas, lembretes, briefing, avisos, comandos
  shared/     regras de tempo, normalizador e provedores de WhatsApp, cliente da IA
tests/
  fixtures/   payloads Z-API, exemplos de contrato, respostas determinísticas de IA
  golden/     saídas aprovadas
scripts/      execução de testes de integração e visuais
```
