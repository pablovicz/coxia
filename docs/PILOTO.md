# Coxia — roteiro do piloto com a Casa Kaju

Este roteiro cobre o que a Etapa 4 não consegue validar sem a equipe e uma instância real da Z-API:
a Etapa 0 (payloads reais), a subida no Railway e duas semanas de uso real.
Cada item tem o que fazer, como saber que deu certo e o que anotar.

## 1. Antes de começar (1 dia)

| Item | Quem | Pronto quando |
|---|---|---|
| Número de WhatsApp dedicado à Coxia, num celular que fica na casa, carregado e com internet | Casa Kaju | O número não é o pessoal de ninguém |
| Instância Z-API conectada a esse número (QR code) | Casa Kaju + dev | Painel da Z-API mostra "conectado" |
| Confirmar horários de funcionamento das três salas e os dias de vencimento das contas | Casa Kaju | Valores do seed (`packages/database/prisma/seed.ts`) substituídos pelos reais |
| Lista de quem administra (owner/admin), quem coordena projetos e quem recebe o briefing das 08:00 | Casa Kaju | Telefones com DDI+DDD, sem espaços |
| Prazo de retenção de mensagens (padrão: 730 dias) | Casa Kaju | Valor combinado e anotado em `organizations.retention_days` |

## 2. Etapa 0 — payloads reais da Z-API (meio dia)

As fixtures em `tests/fixtures/zapi` foram montadas pela documentação (`manifest.json` marca cada uma).
Com a instância conectada e o webhook apontando para um ambiente de teste:

1. Configure o callback "ao receber" para `https://<api-staging>/webhooks/zapi/<ZAPI_WEBHOOK_SECRET>`.
2. Gere cada caso abaixo e copie o payload bruto de `messages.raw_payload`:
   - texto em conversa direta;
   - primeira mensagem num grupo `PROJETO - Teste` (o número da Coxia já no grupo);
   - áudio gravado na hora (PTT) no grupo;
   - foto com legenda e PDF no grupo;
   - mensagem enviada pelo próprio número da Coxia (`fromMe`);
   - mesma mensagem reenviada (a Z-API reenvia quando o callback falha: derrube a api por 1 min);
   - grupo renomeado; participante adicionado/removido.
3. Anonimize telefones e nomes, substitua as fixtures, marque `"source": "real"` no `manifest.json` e rode
   `UPDATE_GOLDEN=1 pnpm --filter @coxia/shared test`. **Revise o diff**: qualquer campo que mudou de
   nome ou formato é um ajuste no normalizador, não no golden.
4. Anote os riscos observados (atraso de callback, mídia expirando, grupos com `@lid` em vez de telefone).

## 3. Subida no Railway (meio dia)

1. Instale o CLI e rode `railway config plan` com `.railway/railway.ts`. Antes, resolva os TODOs do arquivo:
   região do bucket e nomes das variáveis expostas por ele.
2. `railway config apply` depois de revisar o plano.
3. Variáveis obrigatórias: `ZAPI_*`, `ZAPI_WEBHOOK_SECRET` (longo, aleatório), `JWT_SECRET`,
   `AI_SERVICE_TOKEN`, `AI_PROVIDER=openai`, `OPENAI_API_KEY`, `SEED_ADMIN_*`.
4. Rode o seed uma vez e entre no painel com a administradora inicial.
5. Smoke: mande "Resumo de hoje" no privado para o número da Coxia → resposta em menos de 30 s.

## 4. Roteiro de aceite com a equipe (1 encontro de ~1h)

Faça em ordem, com o painel aberto em **Configurações → Operação** para ver as filas.

| # | Ação no WhatsApp | Esperado |
|---|---|---|
| 1 | Admin: "Quais salas estão livres amanhã à tarde?" | Lista por sala, horários no fuso de São Paulo |
| 2 | Admin: "Reserva a sala grande sexta das 14h às 17h para a Micaela" | "Reservado: …"; aparece na agenda do painel |
| 3 | Outra admin, ao mesmo tempo, reserva a mesma sala e horário | Uma recebe a confirmação, a outra o conflito com quem ocupa |
| 4 | Admin: "Cancela a reserva das 15h de sexta" → "SIM" | Pede confirmação; só cancela com o SIM de quem pediu |
| 5 | Admin manda foto do comprovante: "Paguei a internet" | Conta do mês marcada como paga; mesmo comprovante de novo é recusado |
| 6 | Criar grupo `PROJETO - Teste`, adicionar a Coxia, admin escreve no grupo | Mensagem de boas-vindas com aviso de retenção; projeto aparece no painel |
| 7 | Admin manda áudio de briefing (objetivo, prazos, responsáveis, orçamento) | Resumo do briefing no grupo; tarefas propostas no painel |
| 8 | Participante: "Eu fecho o cartaz até quarta"; outro: "Seria bom ver a luz" | Primeira vira tarefa aberta; segunda fica "para revisar" |
| 9 | Participante manda orçamento ("Orçamento do som: 2.500") | Cotação proposta, **não** paga |
| 10 | Participante comum escreve "encerrado" | Coxia responde que só quem coordena encerra |
| 11 | Admin escreve "encerrado" → "SIM" | Prévia com pendências; depois o relatório; projeto encerrado no painel |
| 12 | Desligar a internet do celular da Coxia por 10 min e mandar comandos | Painel mostra "WhatsApp desconectado"; respostas saem ao reconectar, sem duplicar |

Anote para cada item: funcionou / funcionou com ressalva / falhou, e o texto exato quando a Coxia
entendeu errado (vira fixture de avaliação da IA).

## 5. Duas semanas de uso real

- **Diário (5 min, quem administra):** em Configurações → Operação, conferir mensagens com falha e envios
  que não saíram; reprocessar quando fizer sentido.
- **Semanal (30 min, dev + coordenação):**
  - frases que a Coxia interpretou errado → novas fixtures em `tests/fixtures/ai` e ajuste de prompt
    (nova versão em `apps/ai/coxia_ai/prompts.py`);
  - custo de IA (tokens por operação na tela de operação);
  - avisos que incomodaram ou faltaram (política anti-spam em `packages/domain/src/notifications.ts`);
  - ajustes de tela no celular, com print.
- **Critério para encerrar o piloto:** os itens 1–12 passam sem ressalva, nenhum lançamento duplicado em
  duas semanas, e a equipe usa o briefing das 08:00 sem pedir para desligar.

## 6. Alertas e plano de contingência

| Sinal | Onde aparece | O que fazer |
|---|---|---|
| WhatsApp desconectado | Log `WhatsApp desconectado: envios pausados`; banner na tela de operação | Reconectar o número no painel da Z-API (QR code). Os avisos ficam em espera e saem depois, sem duplicar |
| Mensagens com falha (IA fora do ar) | Tela de operação; `ai_executions.status = failed` | Reprocessar quando a IA voltar; o reprocessamento não duplica nada |
| Envio no dead-letter | Tela de operação | Ver o erro (ex.: número inválido), corrigir o cadastro e reenviar |
| Fila de mensagens atrasada | `inbound.oldestPendingSeconds` alto | Ver se o worker está no ar (healthcheck do Railway) |
| Z-API indisponível por muito tempo | — | O provedor é isolado por `WhatsappProvider`: trocar por outro provedor exige só uma nova implementação |

Sugestão no Railway: alerta por log para `"level":50` nos serviços `api` e `worker`.
