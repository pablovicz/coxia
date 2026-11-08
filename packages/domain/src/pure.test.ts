import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openIntervals, subtractIntervals, withinOperatingHours } from './availability';
import { resolveBillHint, statusAfterPayment } from './bills';
import { type BriefingState, composeMorningBriefing } from './briefing';
import { type PlannerInput, planNotifications } from './notifications';
import { nextReminderRun } from './reminders';
import { resolveSpaceHint } from './spaces';

const TZ = 'America/Sao_Paulo';
const at = (local: string) => new Date(`${local}-03:00`);
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

describe('horário de funcionamento', () => {
  const rules = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: '08:00', closesAt: '22:00' }));

  it('aceita dentro, rejeita antes/depois/domingo/virando a noite', () => {
    expect(withinOperatingHours(rules, at('2026-11-13T14:00'), at('2026-11-13T17:00'), TZ)).toBe(true);
    expect(withinOperatingHours(rules, at('2026-11-13T07:30'), at('2026-11-13T09:00'), TZ)).toBe(false);
    expect(withinOperatingHours(rules, at('2026-11-13T21:00'), at('2026-11-13T22:30'), TZ)).toBe(false);
    expect(withinOperatingHours(rules, at('2026-11-15T10:00'), at('2026-11-15T11:00'), TZ)).toBe(false);
    expect(withinOperatingHours(rules, at('2026-11-13T21:00'), at('2026-11-14T01:00'), TZ)).toBe(false);
    expect(withinOperatingHours([], at('2026-11-15T03:00'), at('2026-11-15T04:00'), TZ)).toBe(true);
  });

  it('livres = funcionamento − reservas', () => {
    const open = openIntervals(rules, '2026-11-13', TZ);
    const free = subtractIntervals(open, [
      { start: at('2026-11-13T09:00'), end: at('2026-11-13T11:00') },
      { start: at('2026-11-13T14:00'), end: at('2026-11-13T17:00') },
    ]);
    expect(free.map((f) => [f.start.toISOString(), f.end.toISOString()])).toEqual([
      ['2026-11-13T11:00:00.000Z', '2026-11-13T12:00:00.000Z'],
      ['2026-11-13T14:00:00.000Z', '2026-11-13T17:00:00.000Z'],
      ['2026-11-13T20:00:00.000Z', '2026-11-14T01:00:00.000Z'],
    ]);
  });
});

describe('resolução de nomes', () => {
  const spaces = [
    { name: 'Sala Grande', slug: 'sala-grande', aliases: ['salão'] },
    { name: 'Sala Média', slug: 'sala-media', aliases: [] },
    { name: 'Sala Pequena', slug: 'sala-pequena', aliases: [] },
  ];
  it.each([
    ['sala grande', 'Sala Grande'],
    ['a sala media', 'Sala Média'],
    ['salão', 'Sala Grande'],
    ['pequena', 'Sala Pequena'],
  ])('%s → %s', (hint, name) => {
    expect(resolveSpaceHint(spaces, hint).match?.name).toBe(name);
  });
  it('"sala" é ambíguo', () => {
    const r = resolveSpaceHint(spaces, 'sala');
    expect(r.match).toBeNull();
    expect(r.candidates).toHaveLength(3);
  });
  it('contas por nome ou sinônimo', () => {
    const bills = [
      { name: 'Energia elétrica', category: 'energia' },
      { name: 'Água', category: 'agua' },
      { name: 'Aluguel', category: 'aluguel' },
    ];
    expect(resolveBillHint(bills, 'a conta de luz').match?.name).toBe('Energia elétrica');
    expect(resolveBillHint(bills, 'agua').match?.name).toBe('Água');
    expect(resolveBillHint(bills, 'aluguel').match?.name).toBe('Aluguel');
    expect(resolveBillHint(bills, 'gás').match).toBeNull();
  });
});

describe('pagamento', () => {
  it.each([
    [10000, 10000, 'paid'],
    [10000, 12000, 'paid'],
    [10000, 4000, 'partially_paid'],
    [null, 5000, 'paid'],
    [10000, 0, 'pending'],
  ] as const)('previsto %s, pago %s → %s', (expected, paid, status) => {
    expect(statusAfterPayment(expected, paid)).toBe(status);
  });
});

describe('lembretes recorrentes', () => {
  it('mantém o horário local e pula para a próxima data', () => {
    const first = at('2026-11-10T09:00');
    expect(nextReminderRun('FREQ=WEEKLY;BYDAY=TU', first, at('2026-11-10T09:00'), TZ)?.toISOString()).toBe('2026-11-17T12:00:00.000Z');
    expect(nextReminderRun('FREQ=MONTHLY;BYMONTHDAY=31', at('2027-01-31T10:00'), at('2027-01-31T10:00'), TZ)?.toISOString()).toBe(
      '2027-02-28T13:00:00.000Z',
    );
    expect(nextReminderRun('FREQ=WEEKLY;BYDAY=TU;COUNT=1', first, first, TZ)).toBeNull();
  });
});

const briefingState: BriefingState = {
  organizationName: 'Casa Kaju',
  date: '2026-11-13',
  timezone: TZ,
  today: [
    { spaceName: 'Sala Grande', startAt: at('2026-11-13T09:00'), endAt: at('2026-11-13T12:00'), title: 'Ensaio', responsibleName: 'Micaela' },
    { spaceName: 'Sala Pequena', startAt: at('2026-11-13T19:00'), endAt: at('2026-11-13T21:30'), title: null, responsibleName: null },
  ],
  tomorrow: [{ spaceName: 'Sala Média', startAt: at('2026-11-14T14:00'), endAt: at('2026-11-14T17:00'), title: 'Oficina de cerâmica', responsibleName: 'Bruno' }],
  billsOverdue: [{ name: 'Aluguel', dueDate: '2026-11-05', expectedCents: 250000, paidCents: 100000 }],
  billsDueToday: [],
  billsDueTomorrow: [{ name: 'Energia elétrica', dueDate: '2026-11-14', expectedCents: null, paidCents: 0 }],
  remindersToday: [{ title: 'Renovar alvará', at: at('2026-11-13T10:00') }],
  projects: [
    { title: 'XPO', openTasks: 2, overdueTasks: 1, toReview: 3 },
    { title: 'Mostra de dança', openTasks: 0, overdueTasks: 0, toReview: 1 },
    { title: 'Sarau', openTasks: 0, overdueTasks: 0, toReview: 0 },
  ],
};

describe('golden: briefing matinal', () => {
  it('dia cheio', () => golden('briefing-full.txt', composeMorningBriefing(briefingState)));
  it('dia vazio', () =>
    golden(
      'briefing-empty.txt',
      composeMorningBriefing({ ...briefingState, today: [], tomorrow: [], billsOverdue: [], billsDueTomorrow: [], remindersToday: [], projects: [] }),
    ));
  it('sem reservas hoje, mas com contas', () =>
    golden('briefing-no-bookings.txt', composeMorningBriefing({ ...briefingState, today: [], tomorrow: [], remindersToday: [] })));
});

describe('golden: planejamento de notificações', () => {
  const base: PlannerInput = {
    now: at('2026-11-13T08:00'),
    timezone: TZ,
    briefingTime: '08:00',
    briefingRecipients: ['5511900000001'],
    briefingText: () => 'BRIEFING',
    bookingsTomorrow: [],
    bookingsSoon: [],
    bills: [],
    remindersDue: [],
  };
  const bill = (over: Partial<PlannerInput['bills'][number]>) => ({
    occurrenceId: 'occ1',
    name: 'Energia elétrica',
    competence: '2026-11',
    dueDate: '2026-11-14',
    expectedCents: 31000,
    paidCents: 0,
    status: 'pending',
    recipientPhones: ['5511900000002'],
    overdueEveryDays: 3,
    lastOverdueNoticeAt: null,
    ...over,
  });

  it('antes do horário do briefing nada diário sai', () => {
    expect(planNotifications({ ...base, now: at('2026-11-13T07:59'), bills: [bill({})] })).toEqual([]);
  });

  it('briefing às 08:00 com chave do dia', () => {
    const out = planNotifications(base);
    expect(out).toEqual([
      { kind: 'morning_briefing', dedupeKey: 'morning_briefing:2026-11-13', targetType: 'organization', targetId: '2026-11-13', recipients: ['5511900000001'], text: 'BRIEFING' },
    ]);
  });

  it('D-1 da conta só para quem não recebe o briefing', () => {
    const out = planNotifications({ ...base, bills: [bill({ recipientPhones: ['5511900000001', '5511900000002'] })] });
    const d1 = out.find((n) => n.kind === 'bill_day_before')!;
    expect(d1.recipients).toEqual(['5511900000002']);
    expect(d1.dedupeKey).toBe('bill_day_before:occ1');
    expect(d1.text).toBe('A conta de Energia elétrica vence amanhã (sáb, 14/11): R$ 310,00. Quando pagar, me mande o comprovante.');
  });

  it('conta paga não gera aviso; conta só de quem recebe o briefing também não', () => {
    expect(planNotifications({ ...base, bills: [bill({ status: 'paid' })] }).filter((n) => n.kind !== 'morning_briefing')).toEqual([]);
    expect(planNotifications({ ...base, bills: [bill({ recipientPhones: ['5511900000001'] })] }).filter((n) => n.kind !== 'morning_briefing')).toEqual([]);
  });

  it('vence hoje e atrasada (com intervalo de reaviso)', () => {
    const today = planNotifications({ ...base, bills: [bill({ dueDate: '2026-11-13' })] }).find((n) => n.kind === 'bill_due_today');
    expect(today?.text).toBe('A conta de Energia elétrica vence hoje: R$ 310,00. Se já pagou, me mande o comprovante.');

    const overdue = bill({ dueDate: '2026-11-05', status: 'overdue', paidCents: 10000 });
    expect(planNotifications({ ...base, bills: [overdue] }).find((n) => n.kind === 'bill_overdue')?.dedupeKey).toBe('bill_overdue:occ1:2026-11-13');
    // Avisou há 2 dias, intervalo 3: ainda não.
    expect(planNotifications({ ...base, bills: [{ ...overdue, lastOverdueNoticeAt: at('2026-11-11T08:00') }] }).some((n) => n.kind === 'bill_overdue')).toBe(false);
    // Avisou há 3 dias: reavisa.
    expect(planNotifications({ ...base, bills: [{ ...overdue, lastOverdueNoticeAt: at('2026-11-10T08:00') }] }).some((n) => n.kind === 'bill_overdue')).toBe(true);
  });

  it('véspera da reserva para o responsável e aviso de 1h (fora do horário diário também)', () => {
    const occ = { occurrenceId: 'b1', startAt: at('2026-11-14T14:00'), endAt: at('2026-11-14T17:00'), spaceName: 'Sala Grande', title: 'Ensaio', responsiblePhone: '5511900000003' };
    const dayBefore = planNotifications({ ...base, bookingsTomorrow: [occ] }).find((n) => n.kind === 'booking_day_before');
    expect(dayBefore?.text).toBe('Lembrete: amanhã (sáb, 14/11) você tem a Sala Grande das 14h–17h — Ensaio.');

    const soon = { ...occ, startAt: at('2026-11-13T07:30'), endAt: at('2026-11-13T09:00'), notifyOneHourBefore: true };
    const out = planNotifications({ ...base, now: at('2026-11-13T06:45'), bookingsSoon: [soon] });
    expect(out.map((n) => n.kind)).toEqual(['booking_one_hour_before']);
    expect(planNotifications({ ...base, now: at('2026-11-13T06:00'), bookingsSoon: [soon] })).toEqual([]);
  });
});

describe('telefone escrito na mensagem (reserva pelo WhatsApp)', () => {
  it('reconhece os formatos comuns e completa o 55', async () => {
    const { phoneInText } = await import('./commands');
    expect(phoneInText('para a Micaela, 11 98765-4321')).toBe('5511987654321');
    expect(phoneInText('fone (21) 3333-4444 obrigado')).toBe('552133334444');
    expect(phoneInText('+55 11 912345678')).toBe('5511912345678');
    expect(phoneInText('sexta 27 das 14h às 17h')).toBeNull();
  });
});
