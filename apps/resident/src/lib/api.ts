import { createApiClient } from '@coxia/ui/lib/api-client';

export { ApiBodyError, ApiError } from '@coxia/ui/lib/api-client';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '') ?? 'http://localhost:3000';
export const UNAUTHORIZED_EVENT = 'kaju-resident:unauthorized';

/** Sessão no localStorage: o residente continua logado ao escanear o QR da sala no celular. */
export const client = createApiClient({ baseUrl: API_URL, tokenKey: 'kaju-resident-token', storage: 'local', unauthorizedEvent: UNAUTHORIZED_EVENT });
export const { api, apiSend, apiBlob, tokenStore } = client;

// ───────────── tipos (espelham a api /me) ─────────────

export interface Space {
  id: string;
  name: string;
  color: string;
  icon: string;
}

export interface CycleBalance {
  cycle: string;
  startsOn: string;
  endsOn: string;
  renewsOn: string;
  grantedMinutes: number;
  adjustedMinutes: number;
  reservedMinutes: number;
  usedMinutes: number;
  availableMinutes: number;
}

export interface OpenCycle {
  key: string;
  startsOn: string;
  endsOn: string;
  bookableFrom: string;
  bookableUntil: string;
}

export interface Contract {
  id: string;
  space: Space & { slug: string };
  monthlyMinutes: number;
  monthlyAmountCents: number | null;
  paymentDueDay: number | null;
  cycleDay: number;
  bookingOpensDay: number;
  startsOn: string;
  endsOn: string | null;
  status: 'active' | 'ended';
  hasFile: boolean;
  contractFileName: string | null;
  balance?: { current: CycleBalance; next: CycleBalance | null; open: OpenCycle[] };
}

export interface MeResponse {
  resident: { id: string; name: string; email: string | null };
  organization: { id: string; name: string; timezone: string };
  contracts: Contract[];
  /** Senha provisória definida pela equipe: precisa trocar antes de usar o workspace. */
  mustChangePassword: boolean;
  /** Check-in desligado: as horas saem no horário da reserva, sem registro de presença. */
  features?: { checkIn: boolean };
}

export type Attendance = 'upcoming' | 'in_progress' | 'checked_in' | 'no_show';

export interface Occurrence {
  id: string;
  bookingId: string;
  contractId: string | null;
  startAt: string;
  endAt: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  minutes: number;
  checkedInAt: string | null;
  checkInMethod: 'email_link' | 'room_qr' | 'staff' | null;
  attendance: Attendance | null;
  recurring: boolean;
  space: Space;
  canCheckIn: boolean;
  canCancel: boolean;
}

export interface LedgerEntry {
  at: string;
  kind: 'monthly' | 'adjustment' | 'booking';
  minutes: number;
  note?: string | null;
  occurrenceId?: string;
  attendance?: Attendance;
}

export interface ContractDetail {
  contract: Contract;
  open: OpenCycle[];
  cycles: Array<CycleBalance & { ledger: LedgerEntry[] }>;
}

export interface Interval {
  start: string;
  end: string;
}

export interface Availability {
  space: Space;
  openCycles: OpenCycle[];
  days: Array<{ date: string; open: Interval[]; free: Interval[] }>;
  busy: Array<{ startAt: string; endAt: string; mine: boolean; occurrenceId: string | null }>;
}

export interface Payment {
  id: string;
  description: string;
  competence: string | null;
  status: 'expected' | 'received';
  amountCents: number;
  expectedOn: string;
  receivedOn: string | null;
  overdue: boolean;
}

export type RoomStatus =
  | { space: Space; state: 'no_contract' }
  | { space: Space; state: 'checked_in' | 'booking'; occurrence: Occurrence }
  | { space: Space; state: 'occupied'; until: string }
  | { space: Space; state: 'walk_in'; contractId: string; startAt: string; maxMinutes: number; availableMinutes: number }
  | { space: Space; state: 'unavailable'; reason: 'closed' | 'no_balance' | 'too_short' | 'contract_closed'; availableMinutes?: number };

export interface Conflict {
  startAt: string;
  endAt: string;
  reason: 'overlap' | 'blocked' | 'outside_hours';
}

// ───────────── formatação de horas ─────────────

/** 750 → "12h30"; 240 → "4h"; 30 → "30min". */
export function hours(minutes: number): string {
  const sign = minutes < 0 ? '−' : '';
  const abs = Math.abs(minutes);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}min`;
  return `${sign}${h}h${m ? String(m).padStart(2, '0') : ''}`;
}

export const brDate = (iso: string) => iso.slice(0, 10).split('-').reverse().join('/');
export const brDayMonth = (iso: string) => iso.slice(5, 10).split('-').reverse().join('/');
