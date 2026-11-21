import { describe, expect, it } from 'vitest';
import { buildIcs } from './ics';

const base = {
  uid: 'occ_123@casakaju.com',
  sequence: 0,
  startAt: new Date('2026-11-24T17:00:00.000Z'),
  endAt: new Date('2026-11-24T21:00:00.000Z'),
  summary: 'Sala Média — Casa Kaju',
  description: 'Faça o check-in: https://residente.casakaju.com/reservas/occ_123/check-in',
  location: 'Casa Kaju, Sala Média',
  url: 'https://residente.casakaju.com/reservas/occ_123/check-in',
  organizer: { name: 'Casa Kaju', email: 'reservas@casakaju.com' },
  attendee: { name: 'Coletivo Lume', email: 'oi@lume.art' },
  now: new Date('2026-11-21T12:00:00.000Z'),
};

describe('convite .ics — golden', () => {
  it('REQUEST com horários em UTC, alarme e linhas CRLF', () => {
    const ics = buildIcs({ ...base, method: 'REQUEST' });
    expect(ics).toBe(
      [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//Casa Kaju//Coxia//PT-BR',
        'CALSCALE:GREGORIAN',
        'METHOD:REQUEST',
        'BEGIN:VEVENT',
        'UID:occ_123@casakaju.com',
        'SEQUENCE:0',
        'DTSTAMP:20261121T120000Z',
        'DTSTART:20261124T170000Z',
        'DTEND:20261124T210000Z',
        'SUMMARY:Sala Média — Casa Kaju',
        'DESCRIPTION:Faça o check-in: https://residente.casakaju.com/reservas/occ_1',
        ' 23/check-in',
        'LOCATION:Casa Kaju\\, Sala Média',
        'URL:https://residente.casakaju.com/reservas/occ_123/check-in',
        'ORGANIZER;CN="Casa Kaju":mailto:reservas@casakaju.com',
        'ATTENDEE;CN="Coletivo Lume";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FAL',
        ' SE:mailto:oi@lume.art',
        'STATUS:CONFIRMED',
        'TRANSP:OPAQUE',
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        'DESCRIPTION:Sala Média — Casa Kaju',
        'TRIGGER:-PT30M',
        'END:VALARM',
        'END:VEVENT',
        'END:VCALENDAR',
        '',
      ].join('\r\n'),
    );
  });

  it('CANCEL mantém o UID, sobe a SEQUENCE e não tem alarme', () => {
    const ics = buildIcs({ ...base, method: 'CANCEL', sequence: 1 });
    expect(ics).toContain('METHOD:CANCEL');
    expect(ics).toContain('UID:occ_123@casakaju.com');
    expect(ics).toContain('SEQUENCE:1');
    expect(ics).toContain('STATUS:CANCELLED');
    expect(ics).not.toContain('VALARM');
  });

  it('nenhuma linha passa de 75 octetos', () => {
    const ics = buildIcs({ ...base, method: 'REQUEST', description: 'á'.repeat(200) });
    for (const line of ics.split('\r\n')) expect(Buffer.byteLength(line, 'utf8')).toBeLessThanOrEqual(75);
  });
});
