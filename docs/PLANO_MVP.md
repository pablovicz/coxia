# COXIA — Plano de produto e implementação do MVP

> **Nome:** Coxia  
> **Assinatura:** A inteligência por trás da cena.  
> **Origem:** projeto-piloto da Casa Kaju; a plataforma poderá atender outras casas culturais no futuro.  
> **Princípio:** WhatsApp-first, mobile-first, operação assistida por IA.  
> **Versão:** 1.0 — planejamento inicial (novembro de 2026).

## 1. Visão

**Coxia** é um assistente operacional para casas culturais. O trabalho acontece principalmente no WhatsApp; a Coxia identifica acontecimentos, estrutura projetos, administra reservas de salas e acompanha contas e compromissos. O painel web serve para revisão, configuração, histórico e correção de exceções.

O MVP entrega **três módulos end-to-end**: **projetos por grupos**, **agenda de três salas** e **lembretes e contas recorrentes**. O piloto usa **Z-API** como adaptador de WhatsApp, **NestJS** como núcleo de negócio, **FastAPI** como camada estreita de IA, **PostgreSQL**, **Redis/BullMQ**, **React/Vite** e **Railway**.

### Critérios norteadores

- **WhatsApp primeiro:** admins operam pelo WhatsApp; o web administra o que requer visualização ou revisão.
- **IA interpreta; domínio decide:** a IA propõe eventos e ferramentas; permissões, consistência e persistência são determinadas no NestJS.
- **Uma fonte de verdade:** PostgreSQL é o registro canônico, e mensagens são evidências associadas a ações estruturadas.
- **Automação silenciosa:** a Coxia só interrompe o grupo quando existe informação relevante, ambiguidade ou solicitação explícita.
- **Auditoria:** decisões e lançamentos mantêm vínculo com mensagens, autores, horários e confirmações.
- **Do piloto à expansão:** `organization_id` nas entidades do domínio, mesmo com uma organização no MVP.

## 2. Escopo funcional do MVP

### 2.1. Projetos: grupo do WhatsApp = workspace

**Jornada principal**

1. Uma administradora cria `PROJETO - XPO` no WhatsApp e adiciona o número vinculado à Coxia/Z-API.
2. Ao receber a **primeira mensagem válida**, o backend identifica `isGroup`, `phone`/ID do grupo, `chatName` e participante; confirma que o prefixo corresponde ao padrão e que a criação é autorizada. **Não pressupor um webhook exclusivo de criação de grupo.**
3. Cria o `project` e o vínculo `project_channel` idempotentemente, usando o **ID do grupo**, não o nome como chave.
4. A administradora envia um briefing em áudio. O worker baixa/armazena mídia, a FastAPI transcreve e extrai título, objetivo, entregas, prazos, responsáveis, orçamento estimado e dúvidas.
5. O NestJS persiste o briefing estruturado, cria propostas de tarefas e envia um resumo de confirmação.
6. Mensagens seguintes alimentam o histórico do projeto; o motor extrai tarefas, decisões, orçamentos, cotações, despesas e comprovantes e decide se deve propor ou aplicar cada evento.
7. Toda manhã, a Coxia resume as pendências dos **projetos ativos**, para administradores e, opcionalmente, para grupos.
8. Quando uma administradora diz `encerrado`, a Coxia verifica pendências, produz prévia, solicita confirmação e marca o projeto como encerrado, mantendo o histórico.

**Regras**

- Apenas números mapeados como administradores, ou usuários autorizados, criam/encerram workspaces.
- Grupo renomeado: atualizar o nome exibido, **preservar identidade por `group_id`**.
- Uma mensagem não pode gerar duas tarefas/despesas por reenvio do webhook.
- Distinguir compromisso assumido de mera sugestão; cotação não é pagamento; anexo não é automaticamente quitação.
- Despesa fica em `proposed` até validação, ou pode ir a `confirmed` sob regra de confiança/permissão explícita; **`paid` exige comprovação ou confirmação**.
- Cada evento extraído registra `source_message_id`, versão de prompt, parser, autor, modelo e status de revisão.
- Resumos devem usar estado estruturado, não simplesmente pedir para a LLM reler todos os chats.
- Comandos sensíveis no grupo precisam validar **qual participante** os enviou.
- Participantes devem ser informados sobre processamento e armazenamento de mensagens e anexos; definir retenção.

**Limite do MVP:** controle financeiro **por projeto** (lançamentos e comprovantes), sem conciliação bancária, emissão de notas ou gateway de pagamentos.

### 2.2. Agenda de salas

Três salas configuradas na organização piloto; o modelo de dados não impõe limite de três.

**Funcionalidades:** cadastro de salas, dias/horários de funcionamento, bloqueios, reservas avulsas, recorrências, responsáveis, observações, criação/alteração/cancelamento e consulta de disponibilidade via WhatsApp/painel.

**Exemplos de comandos:**

- "Quais salas estão livres amanhã à tarde?"
- "Reserva a sala grande na sexta das 14h às 17h para a Micaela."
- "Toda terça, a sala pequena fica reservada das 19h às 21h."
- "Cancela a reserva das 15h de amanhã." (identificar + confirmar)

**Regras:**

- Registrar timezone da organização (`America/Sao_Paulo` no piloto) e datas canônicas em UTC.
- Intervalos `start_at`/`end_at`; exigir `start_at < end_at` e respeitar bloqueios/funcionamento.
- Evitar conflitos sob concorrência no PostgreSQL, preferencialmente com **EXCLUDE USING gist** para intervalos ativos por sala, e não apenas checagem prévia.
- Ao alterar recorrências, permitir alterar ocorrência isolada ou toda a série; relatar instâncias que conflitam.
- Notificações iniciais: resumo às 08:00 para admins, aviso de reserva no dia anterior e aviso opcional 1h antes para responsável.

### 2.3. Lembretes e contas mensais

**Duas classes:** `one_time_reminder`/`recurring_reminder` e `recurring_bill` com `bill_occurrence` mensal independente.

**Contas-padrão configuráveis:** aluguel, energia elétrica, água, internet, telefone e outras despesas fixas.

**Ciclo:**

1. Cadastro com nome, responsável, dia de vencimento, valor estimado (ou variável), periodicidade e destinatários.
2. Um job gera ocorrências para cada competência mensal, sem duplicidade.
3. Aviso **1 dia antes**, conforme a data exata do vencimento da ocorrência; novo aviso no dia se não paga.
4. Contas vencidas seguem como pendências até resolução, com política configurável de reaviso para evitar spam.
5. Confirmação por texto ou recibo atualiza valor real, data, status e comprovante.
6. Resumo mensal apresenta valores previstos, pagos, pendentes e atrasados.

**Casos de borda:** vencimentos em dias 29/30/31 em meses curtos (regra explícita: último dia do mês), mudança de vencimento, pagamento parcial, comprovante duplicado, pagamento antecipado, alteração posterior de valor e conta suspensa.

### 2.4. Briefing matinal unificado

Às 08:00 do fuso da organização (configurável), a Coxia envia aos números administrativos um **resumo consolidado** de: agenda do dia, reservas de amanhã, pendências de projetos, contas a vencer no dia seguinte e contas atrasadas. Alertas críticos podem chegar separadamente; evitar notificação a cada mensagem do grupo.

## 3. Identidade do produto

- **Produto:** Coxia
- **Assinatura:** A inteligência por trás da cena.
- **Piloto:** Coxia · by Casa Kaju
- **Domínio interno/repositório:** `coxia`
- **Tom de voz:** caloroso, breve, preciso e não burocrático; evitar excesso de emojis em operações financeiras.
- **Direção:** visual editorial inspirando-se na Casa Kaju, com interfaces práticas de gestão.

### Paleta proposta (não oficial)

| Nome | Hex | Uso |
|---|---|---|
| Verde Coxia | `#42634A` | Navegação e ações principais |
| Verde profundo | `#263B30` | Tipografia e contraste |
| Rosa ateliê | `#EBC3BC` | Superfícies secundárias |
| Terracota | `#D86E4B` | Destaques de marca |
| Amarelo solar | `#E7C879` | Realces discretos |
| Papel | `#F7F4EB` | Fundo claro |

Tipografia: **Fraunces** para títulos editoriais, **DM Sans** em toda a UI, **JetBrains Mono** quando for útil para IDs. Componentes usam **tokens semânticos** (incluindo light/dark), não cores de marca codificadas diretamente. Confira `DESIGN_SYSTEM.md` e `tokens.css`.

**Mobile-first:** começar em 360–390px, navegação inferior, agenda em lista diária, cards financeiros, toque >=44px; desktop com sidebar e visualização semanal. Usar React SPA + Vite + Tailwind CSS + shadcn/ui; temas **light, dark e system** com persistência de preferência.

## 4. Arquitetura

```text
WhatsApp (Z-API) ──> NestJS API / Webhooks ────────> PostgreSQL
                            │                         ▲
React SPA ─────────> NestJS REST API                 │
                            │                         │
                            ├── Redis / BullMQ ──> NestJS Worker
                            │                         │
                            │                         ▼
                            └───────────────> FastAPI IA ───> OpenAI

Files: S3-compatible bucket (Railway production; MinIO local)
```

### Separação de responsabilidade

| Serviço | Atribuições |
|---|---|
| `apps/api` | Autenticação, RBAC, REST, webhooks, projetos, reservas, contas, persistência e autorização |
| `apps/worker` | BullMQ, ingestão e processamento de mensagens, reminders, check-ins e reconciliação |
| `apps/ai` | FastAPI/Pydantic, transcrições, extração estruturada, interpretação e sumarização |
| `apps/web` | React SPA, revisão, agenda, cadastro de contas, projetos e configurações |
| `packages/contracts` | OpenAPI, schemas, DTOs e tipos de eventos compartilhados |
| `packages/database` | Prisma schema/migrations e acesso de banco somente por serviços Node autorizados |

**FastAPI não escreve diretamente em tabelas de negócio**. Intercâmbio tipado por contrato HTTP interno, com timeouts e idempotência. NestJS valida autorização, estado atual e conflito antes de aplicar qualquer sugestão da IA.

### Fluxo de webhook

1. Receber o payload da Z-API e validar o segredo/token ou proteção de origem configurada.
2. Registrar envelope bruto de forma segura e normalizar para `InboundMessage`.
3. Deduplicar por `(provider, instance_id, message_id)`; para eventos sem `message_id`, usar chave determinística de evento.
4. Persistir imediatamente, enfileirar processamento e responder HTTP rápido.
5. Worker obtém contexto e mídia, chama FastAPI apenas quando necessário e aplica resultados via métodos de domínio.
6. Notificações saem por um outbox/job confiável, com retries e log de entrega.

**Z-API:** captura de mensagens de grupo via `isGroup`, `phone`, `chatName`, `participantPhone`; a primeira mensagem válida ativa o workspace. Verificar sessão conectada e lidar com `fromMe`; validar payloads reais de criação/renomeação/participantes. Provedor isolado por `WhatsappProvider` (`receiveWebhook`, `sendText`, `sendMedia`, `getMedia`, `getGroupInfo`, `checkConnection`). Como é uma integração via sessão WhatsApp, existe risco de conexão/limitações externas; monitorar e prever contingência.

### Módulos de domínio NestJS

`AuthModule`, `OrganizationModule`, `WhatsappModule`, `ProjectsModule`, `ProjectFinanceModule`, `SpacesModule`, `BookingsModule`, `RemindersModule`, `BillingModule`, `NotificationsModule`, `AuditModule`.

### Modelo inicial de banco

```text
organizations
users
organization_members
whatsapp_instances
whatsapp_groups
conversations
messages
message_attachments

projects
project_channels
project_events
project_tasks
project_decisions
project_expenses
project_summaries

spaces
space_availability_rules
space_blocks
bookings
booking_occurrences

reminders
recurring_bills
bill_occurrences
payment_attachments

notification_schedules
notification_deliveries
idempotency_records
ai_executions
audit_events
```

**Estados sugeridos:** projeto `draft | active | closing | closed`; reserva `tentative | confirmed | cancelled`; conta `pending | partially_paid | paid | overdue | cancelled`; lançamento de projeto `proposed | confirmed | paid | rejected`.

## 5. Monorepo e infraestrutura

```text
coxia/
├── apps/
│   ├── api/                    # NestJS API + Dockerfile
│   ├── worker/                 # NestJS Worker + Dockerfile
│   ├── ai/                     # FastAPI + pyproject.toml + uv.lock + Dockerfile
│   └── web/                    # React/Vite + Tailwind + shadcn + Dockerfile
├── packages/
│   ├── contracts/
│   ├── database/
│   ├── shared/
│   └── config/
├── tests/
│   ├── fixtures/
│   ├── golden/
│   ├── integration/
│   └── e2e/
├── .railway/railway.ts         # Railway IaC; todos os serviços
├── .github/workflows/
├── docker-compose.yml
├── docker-compose.test.yml
├── .env.example
├── pnpm-lock.yaml
├── pnpm-workspace.yaml
├── turbo.json
└── README.md
```

**Gerenciadores:** pnpm + Turborepo para TypeScript, `uv` para serviço Python. Packages compartilhados TypeScript devem ser acessados via monorepo; os contratos FastAPI serão gerados/validados a partir de OpenAPI/JSON Schema em vez de importar arquivos TS diretamente.

**Railway:** usar **Infrastructure as Code** em `.railway/railway.ts`, cobrindo `api`, `worker`, `ai`, `web`, PostgreSQL, Redis e bucket, com parâmetros por ambiente, healthchecks, variáveis e builds Docker. Os antigos `railway.json`/`railway.toml` já foram depreciados para novos serviços; usar IaC do projeto. Comandos: `railway config plan` e `railway config apply` após revisão.

**Docker Compose:** em dev, levantar `web` (5173), `api` (3000), `ai` (8000), `worker`, `postgres` (5432), `redis` (6379) e `minio` (9000) com volumes, healthchecks e redes. Um segundo compose cria ambientes isolados para testes. Serviços com hot-reload no desenvolvimento.

**Observabilidade:** logs estruturados e correlacionados (`trace_id`, `message_id`, `project_id`), métricas de falhas da Z-API, atraso de jobs, custos de tokens, entregas e dead-letter queue. Segredos nas variáveis do Railway; APIs internas em rede privada; URLs de mídia assinadas e com expiração.

## 6. Golden tests — obrigatórios

Golden tests são exemplos de entrada/saída ou estado aprovados e versionados, complementando unitários, integração e E2E. Não são só snapshots visuais: também verificam regras críticas e fluxos de IA.

| Domínio | Golden cases obrigatórios |
|---|---|
| Z-API | payloads texto/áudio/imagem/grupo, `fromMe`, idempotência, eventos de participante e renomeação |
| Projetos | criação por grupo + áudio, extração de tarefas, não duplicar gastos, encerramento autorizado |
| Agenda | reserva válida, conflito concorrente, cancelamento, recorrência com bloqueio |
| Contas | aviso D-1, competência mensal, contas pagas não alertadas, dia 31 em fevereiro |
| FastAPI | extração estruturada por fixtures, versão de prompt/modelo, cenários de ambiguidade |
| Frontend | telas em 390/1440px, light/dark, estados vazios/loading/erro, interação acessível |
| Infra | contratos entre API e IA, healthchecks e smoke tests em Docker Compose/Railway staging |

**Estratégia:**

- Fixar fixtures de transcrição/LLM para os testes determinísticos em CI.
- Rodar avaliação com OpenAI real em suíte isolada (orçamento e monitoramento próprios).
- Usar Playwright screenshots aprovados para regressão visual; mudanças exigem aprovação, não sobrescrita automática.
- Vitest/Jest para serviços TS; pytest para FastAPI; Playwright para E2E e UI.
- Nenhuma feature é considerada pronta sem golden tests aplicáveis.

## 7. Etapas de implementação

### Etapa 0 — validação técnica Z-API

Conectar uma instância de teste, configurar callback seguro, verificar `isGroup`, `chatName`, `phone`, `participantPhone`, mensagem de áudio, comprovante, reenvio e renomeação, além de validar as regras reais de entrada do número em um grupo. Registrar fixtures de todos os payloads e riscos.

### Etapa 1 — fundação

Criar monorepo, Docker Compose, Railway IaC, pipeline CI, Postgres/Redis/MinIO, auth/admin, web app com tokens, light/dark, contratos API–IA, outbox e idempotência.

### Etapa 2 — lembretes e agenda

Implementar três salas, reservas e recorrências, regras de disponibilidade e notificações. Criar contas fixas, competências mensais, baixa de pagamento e resumo matinal. Exercitar ponta a ponta pelo WhatsApp e pelo painel.

### Etapa 3 — projetos com IA

Registrar grupos como workspaces, interpretar briefing de áudio, coletar mensagens e anexos, extrair atividades e despesas, executar check-ins e encerrar projetos com relatório.

### Etapa 4 — estabilização

Falhas/retries, administração de conexão, observabilidade, testes de concorrência, segurança, fluxo real com equipe da Casa Kaju e ajustes de experiência mobile.

## 8. Critérios de aceite

- [ ] Um grupo `PROJETO - XPO` com a Coxia presente gera **um** workspace ao receber a primeira mensagem válida.
- [ ] Áudio inicial gera briefing estruturado e pendências revisáveis.
- [ ] Comprovantes e despesas são associáveis ao projeto sem duplicação.
- [ ] O comando `encerrado` só é executado por autorizados e com confirmação.
- [ ] As três salas são configuráveis, têm agenda e podem ser reservadas pelo WhatsApp.
- [ ] O banco impede sobreposição de reservas confirmadas por sala.
- [ ] Avisos de reservas, contas e pendências são enviados com fuso, horário e destinatários corretos.
- [ ] Cada conta gera uma ocorrência mensal; D-1 chega corretamente; pagamento impede repetição indevida.
- [ ] Dashboard React responsivo com light/dark/system e navegação de celular.
- [ ] NestJS, worker, FastAPI, React, Postgres, Redis e armazenamento sobem no Docker Compose.
- [ ] Todos os serviços do Railway estão definidos no IaC versionado.
- [ ] Golden tests, unitários, integração e E2E aplicáveis passam no CI.

## 9. Fora do MVP

Atendimento comercial público automatizado, gateway de pagamento, conciliação bancária, emissão fiscal, multiempresa operacional, precificação dinâmica e relatórios financeiros avançados. A modelagem manterá espaço para essas evoluções, mas sem implementá-las agora.

## 10. Referências

- Casa Kaju (identidade institucional): https://www.trupenaque.com.br/casa-kaju
- Z-API (webhook de mensagens): https://z-api-docs.vercel.app/webhooks/on-message-received
- Z-API (criação de grupo): https://z-api-docs.vercel.app/group/create-group
- Railway (Infrastructure as Code): https://docs.railway.com/infrastructure-as-code/reference

> Este documento é uma **especificação/planejamento**, não um repositório implementado. Inclui escolhas de arquitetura e critérios de aceite para orientar o desenvolvimento.
