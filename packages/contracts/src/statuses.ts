/** Estados canônicos do domínio (espelham os enums do Prisma). */
export const PROJECT_STATUSES = ['draft', 'active', 'closing', 'closed'] as const;
export const BOOKING_STATUSES = ['tentative', 'confirmed', 'cancelled'] as const;
export const BILL_OCCURRENCE_STATUSES = [
  'pending',
  'partially_paid',
  'paid',
  'overdue',
  'cancelled',
] as const;
export const PROJECT_EXPENSE_STATUSES = ['proposed', 'confirmed', 'paid', 'rejected'] as const;
export const MEMBER_ROLES = ['owner', 'admin', 'staff', 'viewer'] as const;

export type ProjectStatus = (typeof PROJECT_STATUSES)[number];
export type BookingStatus = (typeof BOOKING_STATUSES)[number];
export type BillOccurrenceStatus = (typeof BILL_OCCURRENCE_STATUSES)[number];
export type ProjectExpenseStatus = (typeof PROJECT_EXPENSE_STATUSES)[number];
export type MemberRole = (typeof MEMBER_ROLES)[number];
