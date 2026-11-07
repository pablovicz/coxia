/**
 * Golden/integração da Etapa 3 (projetos com IA) com PostgreSQL real.
 * A IA é simulada: devolve eventos por texto da mensagem, como o FixtureProvider faria.
 */
import { randomUUID } from 'node:crypto';
import type { ExtractBriefingResponse, ExtractProjectEventsRequest, ProjectBriefing, ProjectEvent } from '@coxia/contracts';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type GroupMessageContext, NotificationService, type ProjectAi, ProjectService, ProjectWorkspaceService } from '../src';

const db = createPrismaClient();
const at = (local: string) => new Date(`${local}-03:00`);
const NOW = at('2026-11-09T10:00');
const suffix = String(Date.now()).slice(-8);
const ANA = `55117${suffix}`; // coordena projetos
const BRUNO = `55116${suffix}`; // participante comum

/** Omit distributivo: preserva os campos de cada variante da união. */
type EventSpec = ProjectEvent extends infer E ? (E extends ProjectEvent ? Omit<E, 'sourceMessageId'> : never) : never;
const eventsByText = new Map<string, EventSpec[]>();
const eventRequests: ExtractProjectEventsRequest[] = [];
const briefing: ProjectBriefing = {
  title: 'Mostra XPO',
  objective: 'Mostra de fim de ano',
  deliverables: ['Cartaz'],
  deadlines: [{ description: 'Cartaz aprovado', date: '2026-11-11' }],
  owners: [{ name: 'Bruno', responsibility: 'Comunicação' }],
  estimatedBudgetCents: 800000,
  openQuestions: [],
  proposedTasks: [
    { title: 'Fechar o cartaz', assigneeName: 'Bruno', dueDate: '2026-11-11' },
    { title: 'Contratar o som', assigneeName: null, dueDate: null },
  ],
};
const meta = { executionId: 'stub', model: 'stub', promptVersion: 'project-events@test', parserVersion: '1', inputTokens: 10, outputTokens: 5, latencyMs: 1 };
const ai: ProjectAi = {
  async extractBriefing(): Promise<ExtractBriefingResponse> {
    return { briefing, meta: { ...meta, promptVersion: 'briefing@test' } };
  },
  async extractProjectEvents(req) {
    eventRequests.push(req);
    const last = req.messages.at(-1)!;
    const specs = eventsByText.get(last.text) ?? [];
    return { events: specs.map((s) => ({ ...s, sourceMessageId: last.id }) as ProjectEvent), meta };
  },
};

const workspace = new ProjectWorkspaceService(db, ai);
const projects = new ProjectService(db);
let orgId: string;
let instanceId: string;

interface Group {
  groupId: string;
  conversationId: string;
  chatId: string;
}

async function createGroup(name: string): Promise<Group> {
  const chatId = `${randomUUID()}-group`;
  const g = await db.whatsappGroup.create({ data: { organizationId: orgId, instanceId, externalGroupId: chatId, name } });
  const c = await db.conversation.create({ data: { organizationId: orgId, instanceId, externalChatId: chatId, isGroup: true, groupId: g.id } });
  return { groupId: g.id, conversationId: c.id, chatId };
}

let clock = NOW.getTime();
async function say(
  g: Group,
  phone: string,
  text: string,
  opts: { groupName?: string; fromAudio?: boolean; proof?: string; projectId?: string | null } = {},
) {
  clock += 60_000;
  const sentAt = new Date(clock);
  const msg = await db.message.create({
    data: {
      organizationId: orgId,
      conversationId: g.conversationId,
      direction: 'inbound',
      provider: 'fake',
      dedupeKey: `fake:${randomUUID()}`,
      kind: opts.fromAudio ? 'audio' : opts.proof ? 'image' : 'text',
      senderPhone: phone,
      senderName: phone === ANA ? 'Ana' : 'Bruno',
      text: opts.fromAudio ? null : text,
      sentAt,
    },
  });
  const att = opts.proof
    ? await db.messageAttachment.create({ data: { organizationId: orgId, messageId: msg.id, kind: 'image', sourceUrl: 'https://x/y.jpg', sha256: opts.proof } })
    : null;
  const channel = await db.projectChannel.findUnique({ where: { whatsappGroupId: g.groupId } });
  const ctx: GroupMessageContext = {
    organizationId: orgId,
    conversationId: g.conversationId,
    messageId: msg.id,
    whatsappGroupId: g.groupId,
    groupName: opts.groupName ?? 'PROJETO - XPO',
    senderPhone: phone,
    senderName: phone === ANA ? 'Ana' : 'Bruno',
    sentAt,
    text,
    fromAudio: !!opts.fromAudio,
    attachment: att ? { id: att.id, kind: 'image', sha256: att.sha256 } : null,
    projectId: opts.projectId !== undefined ? opts.projectId : (channel?.projectId ?? null),
    now: sentAt,
  };
  return { ctx, result: await workspace.handle(ctx) };
}

beforeAll(async () => {
  const org = await db.organization.create({ data: { name: 'Casa Teste Projetos', slug: `prj-${randomUUID()}`, retentionDays: 365 } });
  orgId = org.id;
  instanceId = (await db.whatsappInstance.create({ data: { organizationId: orgId, provider: 'fake', externalInstanceId: randomUUID() } })).id;
  const ana = await db.user.create({ data: { name: 'Ana', phone: ANA } });
  const bruno = await db.user.create({ data: { name: 'Bruno', phone: BRUNO } });
  await db.organizationMember.create({ data: { organizationId: orgId, userId: ana.id, role: 'admin', canManageProjects: true, receivesMorningBriefing: true } });
  await db.organizationMember.create({ data: { organizationId: orgId, userId: bruno.id, role: 'staff' } });

  eventsByText.set('Eu fecho o cartaz até quarta', [
    { type: 'task', confidence: 0.92, commitment: 'committed', evidence: 'Eu fecho o cartaz até quarta', title: 'Fechar o cartaz final', assigneeName: 'Bruno', dueDate: '2026-11-11' },
  ]);
  eventsByText.set('Seria bom alguém ver a luz', [
    { type: 'task', confidence: 0.8, commitment: 'suggested', evidence: 'Seria bom alguém ver a luz', title: 'Ver a luz', assigneeName: null, dueDate: null },
  ]);
  eventsByText.set('Orçamento do som chegou: 2.500, ainda não aprovado', [
    { type: 'quote', confidence: 0.9, commitment: 'unclear', evidence: 'Orçamento do som chegou: 2.500', description: 'Sonorização', vendor: null, amountCents: 250000, currency: 'BRL' },
  ]);
  eventsByText.set('Paguei a gráfica, R$ 480,00', [
    { type: 'payment_proof', confidence: 0.88, commitment: 'committed', evidence: 'Paguei a gráfica, R$ 480,00', description: 'Gráfica', amountCents: 48000, currency: 'BRL', paidOn: null },
  ]);
  eventsByText.set('Buffet fechado: R$ 900, pago na entrega', [
    { type: 'expense', confidence: 0.9, commitment: 'committed', evidence: 'Buffet fechado: R$ 900', description: 'Buffet', vendor: null, amountCents: 90000, currency: 'BRL', claimedStatus: 'incurred' },
  ]);
  eventsByText.set('Segue o comprovante do buffet', [
    { type: 'payment_proof', confidence: 0.9, commitment: 'committed', evidence: 'comprovante do buffet', description: 'Buffet', amountCents: 90000, currency: 'BRL', paidOn: null },
  ]);
  eventsByText.set('Cartaz fechado e enviado pra gráfica!', [
    { type: 'task_done', confidence: 0.9, commitment: 'committed', evidence: 'Cartaz fechado', taskTitle: 'Fechar o cartaz' },
  ]);
  eventsByText.set('Ficou decidido: abertura às 19h', [
    { type: 'decision', confidence: 0.9, commitment: 'committed', evidence: 'abertura às 19h', summary: 'Abertura às 19h' },
  ]);
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { phone: { in: [ANA, BRUNO] } } });
  await db.$disconnect();
});

describe('golden: workspace por grupo', () => {
  it('participante sem permissão não cria workspace; a primeira mensagem de quem coordena cria um só', async () => {
    const g = await createGroup('PROJETO - XPO');
    const denied = await say(g, BRUNO, 'Oi gente, bora começar');
    expect(denied.result).toEqual({ projectId: null, reply: null, actions: ['not_authorized_to_activate'] });
    expect(await db.projectChannel.count({ where: { whatsappGroupId: g.groupId } })).toBe(0);

    const first = await say(g, ANA, 'Bem-vindos ao projeto XPO!');
    expect(first.result.actions).toContain('workspace_activated');
    expect(first.result.reply).toContain('Workspace do projeto *XPO* ativado.');
    expect(first.result.reply).toContain('guardados por até 1 ano');

    // Mensagem seguinte (ou reenvio) não cria outro.
    const again = await say(g, ANA, 'ok', { projectId: null });
    expect(again.result.actions).not.toContain('workspace_activated');
    expect(await db.project.count({ where: { organizationId: orgId } })).toBe(1);
  });

  it('ativações simultâneas do mesmo grupo geram um único workspace', async () => {
    const g = await createGroup('PROJETO - Festival');
    const input = { whatsappGroupId: g.groupId, groupName: 'PROJETO - Festival', activatedByPhone: ANA };
    const results = await Promise.all([1, 2, 3].map(() => projects.activateFromGroup(orgId, input, { channel: 'whatsapp', phone: ANA }, NOW)));
    expect(results.filter((r) => r.created)).toHaveLength(1);
    expect(new Set(results.map((r) => r.project.id)).size).toBe(1);
    expect(results[0]!.project.title).toBe('Festival');
  });

  it('renomear o grupo preserva o projeto e atualiza o nome exibido', async () => {
    const g = await createGroup('PROJETO - Sarau');
    const { result } = await say(g, ANA, 'Começando o sarau', { groupName: 'PROJETO - Sarau' });
    const renamed = await say(g, ANA, 'Novo nome do grupo', { groupName: 'PROJETO - Sarau de Verão' });
    expect(renamed.result.projectId).toBe(result.projectId);
    expect(renamed.result.actions).toContain('group_renamed');
    const p = await db.project.findUniqueOrThrow({ where: { id: result.projectId! }, include: { channels: true } });
    expect(p.title).toBe('Sarau de Verão');
    expect(p.channels[0]!.displayName).toBe('PROJETO - Sarau de Verão');
  });
});

describe('golden: briefing e eventos do projeto XPO', () => {
  let g: Group;
  let projectId: string;

  beforeAll(async () => {
    g = await createGroup('PROJETO - XPO');
    projectId = (await say(g, ANA, 'Vamos lá, pessoal')).result.projectId!;
  });

  it('áudio de briefing de quem coordena vira briefing estruturado e tarefas propostas', async () => {
    const { result } = await say(g, ANA, 'transcrição do áudio de briefing', { fromAudio: true });
    expect(result.actions).toEqual(['briefing_registered']);
    expect(result.reply).toContain('Briefing registrado — *XPO*');
    expect(result.reply).toContain('2 tarefas propostas para revisão no painel.');
    const p = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { tasks: true, events: true } });
    expect(p.objective).toBe('Mostra de fim de ano');
    expect(p.estimatedBudgetCents).toBe(800000);
    expect(p.tasks.map((t) => [t.title, t.status])).toEqual([
      ['Fechar o cartaz', 'proposed'],
      ['Contratar o som', 'proposed'],
    ]);
    const ev = p.events.find((e) => e.type === 'briefing')!;
    expect(ev.promptVersion).toBe('briefing@test');
    expect(ev.authorPhone).toBe(ANA);
    expect(ev.aiExecutionId).not.toBeNull();
  });

  it('compromisso promove a tarefa proposta (sem duplicar); sugestão fica para revisão; cotação não é pagamento', async () => {
    await say(g, BRUNO, 'Eu fecho o cartaz até quarta');
    await say(g, BRUNO, 'Seria bom alguém ver a luz');
    await say(g, BRUNO, 'Orçamento do som chegou: 2.500, ainda não aprovado');
    const tasks = await db.projectTask.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } });
    expect(tasks.map((t) => [t.title, t.status, t.assigneeName])).toEqual([
      // "Fechar o cartaz" veio do briefing como proposta; o "eu fecho" do Bruno a promoveu.
      ['Fechar o cartaz', 'open', 'Bruno'],
      ['Contratar o som', 'proposed', null],
      ['Ver a luz', 'proposed', null],
    ]);
    expect(tasks[0]!.sourceEventId).not.toBeNull();
    const quote = await db.projectExpense.findFirstOrThrow({ where: { projectId, kind: 'quote' } });
    expect(quote.status).toBe('proposed');
    expect(quote.amountCents).toBe(250000);
    // Contexto para a IA: estado estruturado + mensagens recentes, sem reler o histórico inteiro.
    const req = eventRequests.at(-1)!;
    expect(req.projectStateSummary).toContain('Fechar o cartaz (Bruno, qua, 11/11)');
    expect(req.messages.length).toBeGreaterThan(1);
  });

  it('reprocessar a mesma mensagem não duplica tarefas nem despesas', async () => {
    const { ctx } = await say(g, BRUNO, 'Orçamento do som chegou: 2.500, ainda não aprovado');
    const before = await db.projectExpense.count({ where: { projectId } });
    const again = await workspace.handle(ctx);
    expect(again.actions).toEqual(['quote:duplicate']);
    expect(await db.projectExpense.count({ where: { projectId } })).toBe(before);
  });

  it('mensagens triviais não chamam a IA', async () => {
    const n = eventRequests.length;
    const { result } = await say(g, BRUNO, 'Valeu!');
    expect(result.actions).toEqual(['trivial']);
    expect(eventRequests.length).toBe(n);
  });

  it('comprovante de participante fica para validação; o mesmo comprovante de novo não lança outra despesa', async () => {
    const sha = 'a'.repeat(64);
    await say(g, BRUNO, 'Paguei a gráfica, R$ 480,00', { proof: sha });
    const exp = await db.projectExpense.findFirstOrThrow({ where: { projectId, proofSha256: sha } });
    expect(exp.status).toBe('proposed');
    expect(exp.amountCents).toBe(48000);

    const dup = await say(g, BRUNO, 'Paguei a gráfica, R$ 480,00', { proof: sha });
    expect(dup.result.reply).toBe('Esse comprovante já foi registrado (Gráfica, R$ 480,00 — XPO). Não lancei de novo.');
    expect(await db.projectExpense.count({ where: { projectId, description: 'Gráfica' } })).toBe(1);

    // Validação no painel: com comprovante anexado, confirmar já quita.
    const reviewed = await projects.reviewExpense(orgId, projectId, exp.id, 'confirm', { channel: 'web', phone: null });
    expect(reviewed.status).toBe('paid');
    const event = await db.projectEvent.findFirstOrThrow({ where: { expense: { id: exp.id } } });
    expect(event.reviewStatus).toBe('confirmed');
  });

  it('comprovante de quem coordena quita a despesa já lançada, sem duplicar', async () => {
    await say(g, ANA, 'Buffet fechado: R$ 900, pago na entrega');
    const buffet = await db.projectExpense.findFirstOrThrow({ where: { projectId, description: 'Buffet' } });
    expect(buffet.status).toBe('confirmed');
    await say(g, ANA, 'Segue o comprovante do buffet', { proof: 'b'.repeat(64) });
    expect(await db.projectExpense.count({ where: { projectId, description: 'Buffet' } })).toBe(1);
    const paid = await db.projectExpense.findUniqueOrThrow({ where: { id: buffet.id } });
    expect(paid.status).toBe('paid');
    expect(paid.proofSha256).toBe('b'.repeat(64));
  });

  it('"terminei" conclui a tarefa certa; decisão de quem coordena é registrada', async () => {
    await say(g, BRUNO, 'Cartaz fechado e enviado pra gráfica!');
    const t = await db.projectTask.findFirstOrThrow({ where: { projectId, title: 'Fechar o cartaz' } });
    expect(t.status).toBe('done');
    expect(t.completedAt).not.toBeNull();
    await say(g, ANA, 'Ficou decidido: abertura às 19h');
    expect((await db.projectDecision.findMany({ where: { projectId } })).map((d) => d.summary)).toEqual(['Abertura às 19h']);
  });

  it('check-in no grupo sai uma vez por dia e só com pendência relevante', async () => {
    await projects.update(orgId, projectId, { groupCheckIns: true }, { channel: 'web' });
    const soon = await db.projectTask.findFirstOrThrow({ where: { projectId, title: 'Contratar o som' } });
    await projects.updateTask(orgId, projectId, soon.id, { status: 'open', dueDate: '2026-11-10' }, { channel: 'web' });
    const notifications = new NotificationService(db);
    const morning = at('2026-11-10T08:05');
    const created = await notifications.run(orgId, morning);
    expect(created).toContain(`project_checkin:${projectId}:2026-11-10`);
    await notifications.run(orgId, at('2026-11-10T08:06'));
    const deliveries = await db.notificationDelivery.findMany({ where: { organizationId: orgId, recipient: g.chatId } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.text).toContain('Vence hoje: Contratar o som');
    expect(await db.projectSummary.count({ where: { projectId, kind: 'daily' } })).toBe(1);
  });

  it('encerramento: só quem coordena, com prévia e confirmação do mesmo participante', async () => {
    const denied = await say(g, BRUNO, 'encerrado');
    expect(denied.result.reply).toBe('Só quem coordena projetos pode encerrar este workspace.');
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe('active');

    const preview = await say(g, ANA, 'Encerrado!');
    expect(preview.result.actions).toEqual(['close_pending']);
    expect(preview.result.reply).toContain('Encerrar o projeto *XPO*?');
    expect(preview.result.reply).toContain('Responda SIM para encerrar.');
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe('closing');

    // "sim" de outro participante não encerra.
    const other = await say(g, BRUNO, 'sim');
    expect(other.result.actions).toEqual(['trivial']);
    expect((await db.project.findUniqueOrThrow({ where: { id: projectId } })).status).toBe('closing');

    const yes = await say(g, ANA, 'SIM');
    expect(yes.result.actions).toEqual(['project_closed']);
    expect(yes.result.reply).toContain('Projeto *XPO* encerrado');
    const closed = await db.project.findUniqueOrThrow({ where: { id: projectId }, include: { summaries: true, tasks: true } });
    expect(closed.status).toBe('closed');
    expect(closed.closedByPhone).toBe(ANA);
    expect(closed.summaries.find((s) => s.kind === 'closing')?.content).toBe(yes.result.reply);
    // Histórico preservado.
    expect(closed.tasks.length).toBeGreaterThan(0);

    // Um segundo "sim" não faz nada.
    const twice = await say(g, ANA, 'sim');
    expect(twice.result.actions).toEqual(['trivial']);
  });

  it('confirmação de encerramento que expira devolve o projeto a ativo', async () => {
    const g2 = await createGroup('PROJETO - Oficina');
    const id = (await say(g2, ANA, 'Começando a oficina', { groupName: 'PROJETO - Oficina' })).result.projectId!;
    await say(g2, ANA, 'encerrar projeto', { groupName: 'PROJETO - Oficina' });
    expect((await db.project.findUniqueOrThrow({ where: { id } })).status).toBe('closing');
    expect(await projects.expireStaleClosings(new Date(clock + 31 * 60_000))).toBeGreaterThanOrEqual(1);
    expect((await db.project.findUniqueOrThrow({ where: { id } })).status).toBe('active');
  });
});
