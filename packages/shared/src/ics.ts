/**
 * Convite de calendário (iCalendar, RFC 5545) para uma reserva.
 * - Mesmo UID para a mesma ocorrência: o calendário do residente atualiza/cancela o evento
 *   em vez de duplicar. SEQUENCE sobe a cada mudança enviada.
 * - Horários em UTC ("Z"): dispensa VTIMEZONE e funciona em Google, Outlook e Apple.
 */

export interface IcsEvent {
  uid: string;
  method: 'REQUEST' | 'CANCEL';
  sequence: number;
  startAt: Date;
  endAt: Date;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  organizer: { name: string; email: string };
  attendee: { name: string; email: string };
  /** DTSTAMP (relógio injetável nos testes). */
  now?: Date;
}

function utc(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/** Escapa texto (RFC 5545 §3.3.11). */
function text(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Dobra linhas com mais de 75 octetos (§3.1), sem quebrar caracteres multibyte. */
const encoder = new TextEncoder();

function fold(line: string): string {
  const out: string[] = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    if (bytes + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  out.push(current);
  return out.join('\r\n ');
}

function param(s: string): string {
  return `"${s.replace(/"/g, "'")}"`;
}

export function buildIcs(e: IcsEvent): string {
  const cancelled = e.method === 'CANCEL';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Casa Kaju//Coxia//PT-BR',
    'CALSCALE:GREGORIAN',
    `METHOD:${e.method}`,
    'BEGIN:VEVENT',
    `UID:${e.uid}`,
    `SEQUENCE:${e.sequence}`,
    `DTSTAMP:${utc(e.now ?? new Date())}`,
    `DTSTART:${utc(e.startAt)}`,
    `DTEND:${utc(e.endAt)}`,
    `SUMMARY:${text(e.summary)}`,
    ...(e.description ? [`DESCRIPTION:${text(e.description)}`] : []),
    ...(e.location ? [`LOCATION:${text(e.location)}`] : []),
    ...(e.url ? [`URL:${e.url}`] : []),
    `ORGANIZER;CN=${param(e.organizer.name)}:mailto:${e.organizer.email}`,
    `ATTENDEE;CN=${param(e.attendee.name)};ROLE=REQ-PARTICIPANT;PARTSTAT=${cancelled ? 'DECLINED' : 'ACCEPTED'};RSVP=FALSE:mailto:${e.attendee.email}`,
    `STATUS:${cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    ...(cancelled
      ? []
      : ['BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${text(e.summary)}`, 'TRIGGER:-PT30M', 'END:VALARM']),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(fold).join('\r\n') + '\r\n';
}
