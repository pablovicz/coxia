# Coxia Design System — v1.0

> Proposta de identidade digital para o MVP da Coxia, inspirado na Casa Kaju. Referência institucional: https://www.trupenaque.com.br/casa-kaju. Não é uma extração oficial de valores cromáticos ou fontes da marca. É uma interpretação voltada ao produto.

**Marca:** Coxia — *A inteligência por trás da cena.*  
**Origem:** projeto-piloto Casa Kaju.  
**Produto:** assistente operacional WhatsApp-first.

## 1. Princípios

1. **Acolhedor, não infantil:** superfícies quentes, formas orgânicas discretas, linguagem humana.
2. **Criativo, não caótico:** um detalhe editorial por tela; dados e operações continuam objetivos.
3. **Operacional, não corporativo genérico:** valorizar a agenda da casa, projetos, oficinas e obrigações concretas.
4. **WhatsApp-first, mobile-first:** o painel complementa a operação do dia a dia; a maioria das ações precisa de poucos toques.
5. **Confiável:** valores, status, vencimentos, permissões e confirmações precisam ser inequívocos.

## 2. Paleta cromática (proposta)

| Token de marca | Hex | Uso |
|---|---|---|
| Verde Coxia | `#42634A` | Primário, botões e navegação ativa no tema claro |
| Verde profundo | `#263B30` | Títulos e texto escuro |
| Rosa ateliê | `#EBC3BC` | Fundos secundários e marcação editorial |
| Terracota | `#D86E4B` | Elementos de apoio e detalhes gráficos |
| Amarelo solar | `#E7C879` | Destaques suaves e avisos com texto escuro |
| Papel | `#F7F4EB` | Fundo principal do tema claro |

**Regra:** usar tokens semânticos (`background`, `primary`, `muted`, `destructive`) em componentes; reservar a paleta de marca bruta para materiais editoriais e comunicação visual. Não usar cores de marca para representar estados financeiros sem semântica.

Os tokens completos para light/dark estão em [`tokens.css`](./tokens.css).

## 3. Tipografia

- **DM Sans**, corpo e componentes: 14–16px, peso 400/500/600.
- **Fraunces**, títulos editoriais e telas de entrada: 28–48px, peso 500/600. Nunca usar em tabelas ou valores monetários.
- **JetBrains Mono**, números de referência e códigos técnicos, apenas quando necessário.
- Para dados monetários e horários, usar `font-variant-numeric: tabular-nums`.
- Escala de tamanhos: 12, 14, 16, 18, 24, 32, 40px. Altura de linha de 1.4–1.6 para corpo.

## 4. Espaçamento e formas

- Base de espaçamento 4px; múltiplos preferidos: 4, 8, 12, 16, 24, 32, 48.
- Cantos: 8px em campos, 12px em botões e 16px em cards; raio máximo 24px em superfícies amplas.
- Sombra leve só onde indica nível ou interação; preferir borda de 1px em tabelas/cards.
- Ícones Lucide com `strokeWidth` 1.75–2 e tamanho de 18–20px na interface.
- Duração de animação 120–220ms. Respeitar `prefers-reduced-motion`.

## 5. Design responsivo

- **Mobile-first** com referência inicial de 360–390px.
- `<640px`: navegação inferior ou drawer, cards em coluna única, agenda diária/lista e botões de largura total em formulários.
- `640–1023px`: duas colunas em cards, sidebar recolhida.
- `>=1024px`: sidebar fixa de 240–264px e conteúdo max-width ~1320px.
- Tap targets no mínimo 44×44px. Sem rolagem horizontal para operações essenciais.
- Não codificar cores de status como único indicador: incluir texto/ícone.

## 6. Componentes base shadcn/ui

| Componente | Variante/estado | Regras |
|---|---|---|
| `Button` | primary, secondary, outline, ghost, destructive; disabled, loading | Primário apenas para ação principal do contexto; confirmar exclusões e encerramentos |
| `Card` | default, interactive, metric | Borda leve, fundo card; versão métrica com título, número e legenda |
| `Badge` | neutral, active, pending, late, archived | Status sempre legível por texto; não depender apenas de cor |
| `Input`, `Textarea` | focus, invalid, disabled | Labels persistentes e mensagem de erro abaixo do campo |
| `Select`, `Popover`, `Command` | default, searchable | Busca em responsáveis, sala e projeto |
| `Dialog`, `AlertDialog` | confirmação | Reservas conflitantes, exclusão e encerramento de projeto |
| `Sheet` | mobile details | Detalhes de reserva/projeto sem abandonar a lista |
| `Tabs` | project details | Visão geral, tarefas, financeiro e histórico |
| `Calendar` | daily, weekly | Mobile primeiro; nunca permitir reservas sobrepostas |
| `Table` / `DataTable` | dense desktop | Tabela com filtros, estado vazio e paginação; no mobile usar listas/cards |
| `Skeleton` | loading | Evitar deslocamento brusco de layout |
| `Toast` / `Sonner` | feedback | Confirmar operações sem bloquear a navegação |
| `ThemeSwitch` | light, dark, system | Seguir preferência do dispositivo por padrão |

## 7. Componentes de domínio — MVP

### Projetos
- **ProjectCard:** título, grupo vinculado, status, última movimentação, pendências, vencimentos e link para detalhes.
- **ActivityTimeline:** eventos extraídos de mensagens com origem e horário; permitir revisar/confirmar classificação de IA.
- **PendingAction:** tarefa, responsável, prazo, prioridade, origem da mensagem e ação rápida.
- **ExpenseReview:** valor, comprovante, categoria, status (proposto/confirmado/pago) e associação ao projeto.
- **ProjectClosureDialog:** confirmação com pendências abertas e relatório de encerramento.

### Agenda de salas
- **RoomSwitcher:** seletor de três salas e opção “todas”.
- **BookingCalendar:** dia/lista no celular e semana no desktop, sem sobreposição indevida.
- **ReservationCard:** sala, horário, pessoa, recorrência e status.
- **AvailabilitySlot:** livre, ocupado, bloqueado, provisional; contraste e legendas consistentes.
- **BookingForm:** sala, data, início, fim, responsável, repetição e observações.

### Lembretes e contas
- **BillOccurrenceCard:** conta, competência, vencimento, valor previsto/real, status e comprovante.
- **MonthlyBillsSummary:** total previsto, pago, pendente e atrasado.
- **ReminderTimeline:** lembretes de amanhã, hoje e atrasados.
- **PaymentConfirmation:** permite registrar valor real, data e comprovante.

## 8. Navegação

- Desktop: **Visão geral**, **Projetos**, **Agenda**, **Lembretes**, **Configurações** na sidebar.
- Mobile: navegação inferior com **Início**, **Projetos**, **Agenda**, **Contas**; demais opções no menu.
- Home: briefing do dia, próximas reservas das salas, projetos com pendências e contas a vencer.
- Padrão de ação principal: botão contextual “Nova reserva”, “Criar projeto” ou “Novo lembrete”.

## 9. Acessibilidade e validação

- WCAG AA como meta: contraste >=4.5:1 para texto normal, >=3:1 para texto grande e elementos não textuais relevantes.
- Verificar contraste **dos pares de token aplicados**, principalmente no tema escuro.
- Estados hover, focus-visible, disabled, loading e error documentados e testados.
- Integração de testes de screenshot Playwright no CI para mobile/desktop, light/dark.
- Golden tests visuais devem comparar snapshots aprovados, com atualização somente sob revisão.
- A IA não altera estados financeiros ou reservas apenas com interpretação não validada.

## 10. Implementação no monorepo

```text
apps/web/
  src/
    styles/
      tokens.css
      index.css
    components/
      ui/                 # shadcn/ui
      domain/
        projects/
        bookings/
        reminders/
    features/
      dashboard/
      projects/
      rooms/
      reminders/
    providers/
      theme-provider.tsx
packages/
  ui/                     # opcional quando houver outro frontend consumidor
```

No MVP com uma única SPA React, prefira manter os componentes shadcn dentro de `apps/web/src/components/ui` para simplificar manutenção. Só extraia `packages/ui` quando houver reutilização real entre aplicações.

### CSS com Tailwind v4

```css
@import "tailwindcss";
@custom-variant dark (&:is(.dark *));
@import "./tokens.css";

@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-border: var(--border);
  --color-ring: var(--ring);
  --font-sans: "DM Sans", sans-serif;
  --font-display: "Fraunces", Georgia, serif;
}
```

Observação: em projetos com Tailwind v4, verificar a ordem de carregamento do CSS global e os imports de fontes no Vite.

## 11. Integração WhatsApp — decisão do MVP

**Provider inicial:** Z-API em vez de Meta Cloud API. O frontend não conversa diretamente com a Z-API; a integração fica em `apps/api` sob interface `WhatsappProvider`, por exemplo `sendMessage`, `getGroupMetadata`, `receiveWebhook` e `getMedia`.

A Z-API documenta envio, webhooks, criação de grupos e metadados de grupos. Há risco de sessão/desconexão e de compatibilidade por ser baseada em WhatsApp Web, então é necessário painel de conexão, reprocessamento e logs. A detecção exata de grupos criados manualmente deve ser validada com payloads reais: **não pressupor que exista um webhook específico de criação de grupo**. Alternativa: detectar o grupo quando a primeira mensagem chega, buscar metadata e criar o workspace se o padrão do nome e as permissões forem válidos.

Referências:
- Institucional Casa Kaju: https://www.trupenaque.com.br/casa-kaju
- Z-API docs: https://v2.developer.z-api.io/
- Grupos Z-API: https://z-api-docs.vercel.app/group/create-group
- Metadados de grupo: https://z-api-docs.vercel.app/group/metadata-group
