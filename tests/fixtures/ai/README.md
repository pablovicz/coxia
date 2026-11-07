# Fixtures de IA (determinísticas)

Usadas pelo `FixtureProvider` do serviço `apps/ai` quando `AI_PROVIDER=fixture` (dev e CI).
Nenhuma chamada à OpenAI acontece nos testes determinísticos.

| Pasta | Chave do arquivo | Conteúdo |
|---|---|---|
| `transcribe/` | `sourceMessageId` | `{ text, durationSeconds }` |
| `briefing/` | `sourceMessageId` **ou** sha256 da transcrição | `ProjectBriefing` |
| `events/` | `id` da última mensagem **ou** sha256 do texto dela | `{ events: ProjectEvent[] }` |
| `commands/` | sha256 do texto em minúsculas com espaços normalizados | `{ command, confidence, clarificationQuestion }` |

Campos iniciados por `_` são comentários e são ignorados (`_input` guarda o texto que gerou a chave).

A chave por texto existe para o smoke no Docker, em que o id interno da mensagem não é conhecido de
antemão. Nessas fixtures, `"sourceMessageId": "$last"` é trocado pelo id da última mensagem enviada.
Para gerar a chave: `sha256` do texto em minúsculas, com espaços colapsados.
Sem fixture correspondente, o provedor devolve um resultado vazio e seguro (sem eventos, intent `none`).

A suíte de avaliação com OpenAI real (orçamento próprio, fora do CI padrão) deve usar os mesmos
casos de entrada e comparar com estas saídas aprovadas.
