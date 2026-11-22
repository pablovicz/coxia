import { describe, expect, it } from 'vitest';
import { senderFor } from './maintenance.service';

const env = {
  EMAIL_FROM: 'Casa Kaju <reservas@casakaju.com>',
  EMAIL_FROM_NOTICES: 'Casa Kaju <noreply@casakaju.com>',
  EMAIL_FROM_RECOVERY: 'Casa Kaju <recovery@casakaju.com>',
  EMAIL_FROM_WELCOME: 'Casa Kaju <contato@casakaju.com>',
};
const access = { template: 'access' as const, residentName: 'Lume', organizationName: 'Casa Kaju', token: 't' };

describe('remetente por tipo de e-mail', () => {
  it('avisos da equipe saem de noreply@', () => {
    expect(senderFor({ template: 'staff_notice', subject: 's', text: 't' }, env)).toBe('Casa Kaju <noreply@casakaju.com>');
  });

  it('redefinição de senha sai de recovery@ e boas-vindas de contato@', () => {
    expect(senderFor({ ...access, purpose: 'reset' }, env)).toBe('Casa Kaju <recovery@casakaju.com>');
    expect(senderFor({ ...access, purpose: 'invite' }, env)).toBe('Casa Kaju <contato@casakaju.com>');
  });

  it('convites de reserva continuam em reservas@', () => {
    const booking = { template: 'booking' as const, method: 'REQUEST' as const, occurrenceId: 'o', sequence: 0, startAt: '', endAt: '', spaceName: '', residentName: '', organizationName: '', timezone: 'America/Sao_Paulo' };
    expect(senderFor(booking, env)).toBe('Casa Kaju <reservas@casakaju.com>');
  });
});
