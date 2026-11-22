import { describe, expect, it } from 'vitest';
import { planNotifications, type PlannerInput } from './notifications';
import { renderResidentEmail } from './resident-emails';
import { renderStaffEmail } from './staff-emails';

const at = (local: string) => new Date(`${local}-03:00`);
const base: PlannerInput = {
  now: at('2026-11-21T09:00'),
  timezone: 'America/Sao_Paulo',
  briefingTime: '08:00',
  briefingRecipients: [],
  briefingText: () => 'briefing',
  bookingsTomorrow: [],
  bookingsSoon: [],
  bills: [],
  remindersDue: [],
};
const bill = {
  occurrenceId: 'b1',
  name: 'Internet',
  competence: '2026-11',
  dueDate: '2026-11-22',
  expectedCents: 15000,
  paidCents: 0,
  status: 'pending',
  recipientPhones: [],
  overdueEveryDays: 3,
  lastOverdueNoticeAt: null,
};

describe('avisos por e-mail para as administradoras', () => {
  it('lembrete sem telefone ainda vai por e-mail', () => {
    const out = planNotifications({
      ...base,
      adminEmails: ['kaoana@casakaju.com', 'julia@casakaju.com'],
      remindersDue: [{ id: 'r1', title: 'Trocar o filtro', message: null, recipientPhones: [], runAt: at('2026-11-21T09:00') }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ recipients: [], email: { to: ['kaoana@casakaju.com', 'julia@casakaju.com'], subject: 'Lembrete: Trocar o filtro', path: '/lembretes' } });
  });

  it('conta vence amanhã: WhatsApp (se houver) e e-mail, com link para o mês', () => {
    const out = planNotifications({ ...base, adminEmails: ['kaoana@casakaju.com'], bills: [{ ...bill, recipientPhones: ['5541999990000'] }] });
    expect(out[0]).toMatchObject({ kind: 'bill_day_before', recipients: ['5541999990000'], email: { subject: 'Conta vence amanhã: Internet · R$ 150,00', path: '/contas/2026-11' } });
  });

  it('a conta vai por e-mail mesmo para quem recebe o briefing no WhatsApp', () => {
    const out = planNotifications({ ...base, briefingRecipients: ['5541999990000'], adminEmails: ['kaoana@casakaju.com'], bills: [{ ...bill, recipientPhones: ['5541999990000'] }] });
    const notice = out.find((p) => p.kind === 'bill_day_before')!;
    expect(notice.recipients).toEqual([]);
    expect(notice.email?.to).toEqual(['kaoana@casakaju.com']);
  });

  it('sem e-mail de administradora e sem telefone: nada é planejado (como antes)', () => {
    expect(planNotifications({ ...base, remindersDue: [{ id: 'r1', title: 'X', message: null, recipientPhones: [], runAt: at('2026-11-21T09:00') }] })).toEqual([]);
  });

  it('o e-mail vira HTML com negrito, quebras de linha e link para o painel', () => {
    const mail = renderStaffEmail(
      { template: 'staff_notice', subject: 'Novo pedido de orçamento: Lume', text: '📩 *Novo pedido*\n\n*Lume*\nE-mail: oi@lume.art <x>', path: '/orcamentos', actionLabel: 'Ver no Coxia', replyTo: 'oi@lume.art' },
      { staffUrl: 'https://coxia.casakaju.com/' },
    );
    expect(mail.html).toContain('<strong>Novo pedido</strong>');
    expect(mail.html).toContain('<strong>Lume</strong><br>E-mail: oi@lume.art &lt;x&gt;');
    expect(mail.html).toContain('href="https://coxia.casakaju.com/orcamentos"');
    expect(mail.text).toBe('📩 Novo pedido\n\nLume\nE-mail: oi@lume.art <x>\n\nhttps://coxia.casakaju.com/orcamentos');
    expect(mail.replyTo).toBe('oi@lume.art');
  });

  it('convite da reserva sem check-in: sem link de check-in, avisa que as horas saem no horário', () => {
    const payload = { template: 'booking' as const, method: 'REQUEST' as const, occurrenceId: 'o1', sequence: 0, startAt: '2026-11-24T17:00:00.000Z', endAt: '2026-11-24T21:00:00.000Z', spaceName: 'Sala Média', residentName: 'Lume', organizationName: 'Casa Kaju', timezone: 'America/Sao_Paulo' };
    const ctx = { appUrl: 'https://residente.casakaju.com', fromEmail: 'reservas@casakaju.com', fromName: 'Casa Kaju', to: 'oi@lume.art' };
    const off = renderResidentEmail(payload, { ...ctx, checkInEnabled: false });
    expect(off.html).not.toContain('check-in');
    expect(off.html).toContain('https://residente.casakaju.com/reservas"');
    expect(off.text).toContain('as horas voltam');
    expect(renderResidentEmail(payload, { ...ctx, checkInEnabled: true }).html).toContain('/reservas/o1/check-in');
  });

  it('todo e-mail tem o cabeçalho com o logo da Kaju e "Casa Kaju"', () => {
    const staff = renderStaffEmail({ template: 'staff_notice', subject: 'Lembrete: X', text: 'Lembrete: X' }, { staffUrl: 'https://coxia.casakaju.com', logoUrl: 'https://residente.casakaju.com/email/kaju-mark.png' });
    expect(staff.html).toContain('<img src="https://residente.casakaju.com/email/kaju-mark.png" width="40" height="40"');
    expect(staff.html).toContain('>Casa Kaju</td>');
    const invite = renderResidentEmail(
      { template: 'access', purpose: 'invite', residentName: 'Lume', organizationName: 'Casa Kaju', token: 't' },
      { appUrl: 'https://residente.casakaju.com/', fromEmail: 'contato@casakaju.com', fromName: 'Casa Kaju', to: 'oi@lume.art' },
    );
    expect(invite.html).toContain('src="https://residente.casakaju.com/email/kaju-mark.png"');
    expect(invite.html.indexOf('>Casa Kaju</td>')).toBeLessThan(invite.html.indexOf('<h1'));
  });
});
