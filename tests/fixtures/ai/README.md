# Fixtures de IA (determinísticas)

Usadas pelo `FixtureProvider` do serviço `apps/ai` quando `AI_PROVIDER=fixture` (dev e CI).
Nenhuma chamada à OpenAI acontece nos testes determinísticos.

| Pasta | Chave do arquivo | Conteúdo |
|---|---|---|
| `transcribe/` | `sourceMessageId` | `{ text, durationSeconds }` |
| `briefing/` | `sourceMessageId` | `ProjectBriefing` |
| `events/` | `id` da última mensagem enviada | `{ events: ProjectEvent[] }` |
| `commands/` | sha256 do texto em minúsculas com espaços normalizados | `{ command, confidence, clarificationQuestion }` |

Campos iniciados por `_` são comentários e são ignorados.
Sem fixture correspondente, o provedor devolve um resultado vazio e seguro (sem eventos, intent `none`).

A suíte de avaliação com OpenAI real (orçamento próprio, fora do CI padrão) deve usar os mesmos
casos de entrada e comparar com estas saídas aprovadas.
