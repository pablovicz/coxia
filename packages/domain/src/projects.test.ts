import type { ProjectBriefing, ProjectEvent } from '@coxia/contracts';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type PlannerInput, planNotifications } from './notifications';
import {
  composeBriefingConfirmation,
  composeClosingPreview,
  composeClosingReport,
  composeProjectCheckIn,
  composeWorkspaceWelcome,
  decideEvent,
  eventFingerprint,
  isBriefingText,
  isCloseCommand,
  isTrivialMessage,
  matchTaskTitle,
  type ProjectState,
  projectStateText,
  projectTitleFromGroupName,
} from './projects';

const goldenDir = join(__dirname, '..', '..', '..', 'tests', 'golden', 'domain');

function golden(name: string, actual: string) {
  const path = join(goldenDir, name);
  if (process.env.UPDATE_GOLDEN === '1') {
    mkdirSync(goldenDir, { recursive: true });
    writeFileSync(path, actual + '\n');
  }
  if (!existsSync(path)) throw new Error(`golden ausente: ${path}. Rode com UPDATE_GOLDEN=1 e revise.`);
  expect(actual + '\n').toBe(readFileSync(path, 'utf8').replace(/\r\n/g, '\n'));
}

describe('workspace pelo nome do grupo', () => {
  it.each([
    ['PROJETO - XPO', 'XPO'],
    ['Projeto – Mostra de Dança', 'Mostra de Dança'],
    ['projeto: Festival 2027', 'Festival 2027'],
    ['  PROJETO   XPO ', 'XPO'],
    ['PROJETO | Sarau | Kaju', 'Sarau | Kaju'],
  ])('%s → %s', (name, title) => expect(projectTitleFromGroupName(name, 'PROJETO')).toBe(title));
});

describe('palavras-chave determinísticas', () => {
  it.each([
    ['encerrado', true],
    ['Encerrado!', true],
    ['projeto encerrado.', true],
    ['encerrar projeto', true],
    ['Pode encerrar o projeto', true],
    ['encerrado o cartaz?', false],
    ['vamos encerrar a tarefa do som', false],
  ])('fechar "%s" → %s', (text, expected) => expect(isCloseCommand(text)).toBe(expected));

  it('briefing por texto', () => {
    expect(isBriefingText('Briefing: mostra de fim de ano')).toBe(true);
    expect(isBriefingText('briefing - mostra')).toBe(true);
    expect(isBriefingText('o briefing chegou?')).toBe(false);
  });

  it.each([
    ['ok', true],
    ['Obrigada!!', true],
    ['👍', true],
    ['kkkkk', true],
    ['Bom dia', true],
    ['Eu fecho o cartaz até quarta', false],
    ['Paguei a gráfica, R$ 480,00', false],
  ])('trivial "%s" → %s', (text, expected) => expect(isTrivialMessage(text)).toBe(expected));
});

const base = { sourceMessageId: 'm1', evidence: 'x' } as const;
const ev = {
  taskCommitted: { ...base, type: 'task', confidence: 0.92, commitment: 'committed', title: 'Fechar o cartaz', assigneeName: 'Bruno', dueDate: '2026-11-11' },
  taskSuggested: { ...base, type: 'task', confidence: 0.9, commitment: 'suggested', title: 'Ver a luz', assigneeName: null, dueDate: null },
  taskLowConfidence: { ...base, type: 'task', confidence: 0.6, commitment: 'committed', title: 'Ligar pro fornecedor', assigneeName: null, dueDate: null },
  taskDone: { ...base, type: 'task_done', confidence: 0.9, commitment: 'committed', taskTitle: 'Fechar o cartaz' },
  decision: { ...base, type: 'decision', confidence: 0.9, commitment: 'committed', summary: 'Abertura às 19h' },
  quote: { ...base, type: 'quote', confidence: 0.95, commitment: 'committed', description: 'Som', vendor: null, amountCents: 250000, currency: 'BRL' },
  expensePaid: { ...base, type: 'expense', confidence: 0.9, commitment: 'committed', description: 'Gráfica', vendor: null, amountCents: 48000, currency: 'BRL', claimedStatus: 'paid' },
  expensePlanned: { ...base, type: 'expense', confidence: 0.9, commitment: 'committed', description: 'Buffet', vendor: null, amountCents: 90000, currency: 'BRL', claimedStatus: 'planned' },
  paymentProof: { ...base, type: 'payment_proof', confidence: 0.85, commitment: 'committed', description: 'Gráfica', amountCents: 48000, currency: 'BRL', paidOn: null },
  question: { ...base, type: 'question', confidence: 0.8, commitment: 'unclear', question: 'Quem leva o projetor?' },
  closeRequest: { ...base, type: 'close_request', confidence: 0.9, commitment: 'committed', reason: null },
} satisfies Record<string, ProjectEvent>;

describe('golden: política de eventos (a IA propõe, o domínio decide)', () => {
  it('tabela de decisões', () => {
    const table: Record<string, unknown> = {};
    for (const [name, e] of Object.entries(ev)) {
      for (const isManager of [true, false]) {
        for (const hasProof of [false, true]) {
          table[`${name} | ${isManager ? 'coordenação' : 'participante'} | ${hasProof ? 'com anexo' : 'sem anexo'}`] = decideEvent(e, { isManager, hasProof });
        }
      }
    }
    golden('project-event-policy.json', JSON.stringify(table, null, 2));
  });

  it('regras críticas, explícitas', () => {
    // Cotação nunca vira despesa paga, nem com anexo.
    expect(decideEvent(ev.quote, { isManager: true, hasProof: true }).expense).toEqual({ kind: 'quote', status: 'proposed', withProof: false });
    // "Paguei" sem comprovante não vira paid.
    expect(decideEvent(ev.expensePaid, { isManager: true, hasProof: false }).expense?.status).toBe('confirmed');
    // Participante comum: fica para validação, mesmo com comprovante.
    expect(decideEvent(ev.expensePaid, { isManager: false, hasProof: true })).toMatchObject({ review: 'pending_review', expense: { status: 'proposed', withProof: true } });
    // Sugestão não vira compromisso.
    expect(decideEvent(ev.taskSuggested, { isManager: true, hasProof: false })).toEqual({ review: 'pending_review', task: 'proposed' });
    // Encerramento pedido por quem não coordena é descartado.
    expect(decideEvent(ev.closeRequest, { isManager: false, hasProof: false })).toEqual({ review: 'rejected' });
  });

  it('fingerprint ignora confiança e trecho, mas muda com o valor', () => {
    expect(eventFingerprint(ev.quote)).toBe(eventFingerprint({ ...ev.quote, confidence: 0.5, evidence: 'outro trecho' }));
    expect(eventFingerprint({ ...ev.taskCommitted, title: 'fechar  o CARTAZ' })).toBe(eventFingerprint(ev.taskCommitted));
    expect(eventFingerprint(ev.quote)).not.toBe(eventFingerprint({ ...ev.quote, amountCents: 260000 }));
  });

  it('casa "terminei" com uma única tarefa', () => {
    const tasks = [{ title: 'Fechar o cartaz' }, { title: 'Contratar o som' }, { title: 'Revisar o som do palco' }];
    expect(matchTaskTitle(tasks, 'fechar o cartaz')).toEqual({ title: 'Fechar o cartaz' });
    expect(matchTaskTitle(tasks, 'cartaz')).toEqual({ title: 'Fechar o cartaz' });
    expect(matchTaskTitle(tasks, 'som')).toBeNull(); // ambíguo
    expect(matchTaskTitle(tasks, 'buffet')).toBeNull();
  });
});

const state: ProjectState = {
  id: 'p1',
  title: 'XPO',
  status: 'active',
  estimatedBudgetCents: 800000,
  tasks: [
    { id: 't1', title: 'Fechar o cartaz', assigneeName: 'Bruno', dueDate: '2026-11-11', status: 'open' },
    { id: 't2', title: 'Contratar o som', assigneeName: null, dueDate: '2026-11-13', status: 'open' },
    { id: 't3', title: 'Confirmar buffet', assigneeName: 'Ana', dueDate: '2026-11-14', status: 'open' },
    { id: 't4', title: 'Ver a luz', assigneeName: null, dueDate: null, status: 'proposed' },
    { id: 't5', title: 'Reservar a sala grande', assigneeName: 'Ana', dueDate: '2026-11-05', status: 'done' },
  ],
  expenses: [
    { id: 'e1', kind: 'expense', description: 'Gráfica', vendor: 'Gráfica Central', amountCents: 48000, status: 'paid' },
    { id: 'e2', kind: 'quote', description: 'Sonorização', vendor: null, amountCents: 250000, status: 'proposed' },
    { id: 'e3', kind: 'expense', description: 'Buffet', vendor: null, amountCents: 90000, status: 'confirmed' },
  ],
  decisions: ['Abertura às 19h', 'Entrada gratuita'],
  openQuestions: ['Quem leva o projetor?'],
  pendingReview: 3,
};

const briefing: ProjectBriefing = {
  title: 'Mostra XPO',
  objective: 'Mostra de fim de ano dos alunos de dança',
  deliverables: ['Cartaz', 'Programa impresso'],
  deadlines: [
    { description: 'Cartaz aprovado', date: '2026-11-11' },
    { description: 'Data da mostra a definir', date: null },
  ],
  owners: [
    { name: 'Bruno', responsibility: 'Comunicação' },
    { name: 'Ana', responsibility: null },
  ],
  estimatedBudgetCents: 800000,
  openQuestions: ['Vai ter venda de ingressos?'],
  proposedTasks: [
    { title: 'Fechar o cartaz', assigneeName: 'Bruno', dueDate: '2026-11-11' },
    { title: 'Contratar o som', assigneeName: null, dueDate: null },
  ],
};

describe('golden: mensagens de projeto', () => {
  it('boas-vindas com aviso de privacidade e retenção', () => golden('project-welcome.txt', composeWorkspaceWelcome('XPO', 730)));
  it('confirmação do briefing', () => golden('project-briefing.txt', composeBriefingConfirmation('XPO', briefing)));
  it('briefing vazio pede de novo', () =>
    golden(
      'project-briefing-empty.txt',
      composeBriefingConfirmation('XPO', { ...briefing, objective: null, deliverables: [], deadlines: [], owners: [], estimatedBudgetCents: null, openQuestions: [], proposedTasks: [] }),
    ));
  it('prévia de encerramento com pendências', () => golden('project-closing-preview.txt', composeClosingPreview(state)));
  it('prévia de encerramento sem pendências', () =>
    golden(
      'project-closing-preview-clean.txt',
      composeClosingPreview({ ...state, tasks: state.tasks.filter((t) => t.status === 'done'), expenses: [state.expenses[0]!], pendingReview: 0 }),
    ));
  it('relatório de encerramento', () => golden('project-closing-report.txt', composeClosingReport(state, '2026-12-15')));
  it('check-in do dia', () => golden('project-checkin.txt', composeProjectCheckIn(state, '2026-11-13', '2026-11-14')!));
  it('check-in sem pendência relevante não sai', () => {
    expect(composeProjectCheckIn({ ...state, tasks: [state.tasks[3]!, state.tasks[4]!] }, '2026-11-13', '2026-11-14')).toBeNull();
  });
  it('estado enviado à IA', () => golden('project-state-for-ai.txt', projectStateText(state)));
});

describe('check-in no planejador', () => {
  const input = (time: string): PlannerInput => ({
    now: new Date(`2026-11-13T${time}:00-03:00`),
    timezone: 'America/Sao_Paulo',
    briefingTime: '08:00',
    briefingRecipients: [],
    briefingText: () => '',
    bookingsTomorrow: [],
    bookingsSoon: [],
    bills: [],
    remindersDue: [],
    projectCheckIns: [
      { projectId: 'p1', groupChatId: '1203-group', text: () => 'CHECKIN' },
      { projectId: 'p2', groupChatId: '1204-group', text: () => null },
    ],
  });
  it('sai uma vez por dia, só para quem tem pendência, a partir do horário do briefing', () => {
    expect(planNotifications(input('07:59'))).toEqual([]);
    expect(planNotifications(input('08:00'))).toEqual([
      { kind: 'project_checkin', dedupeKey: 'project_checkin:p1:2026-11-13', targetType: 'project', targetId: 'p1', recipients: ['1203-group'], text: 'CHECKIN' },
    ]);
  });
});
