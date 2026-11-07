import type { ExpenseStatus, ProjectStatus, TaskStatus } from '@/lib/api';

type Variant = 'active' | 'pending' | 'late' | 'archived' | 'neutral' | 'info';

/** Rótulos com símbolo: o status nunca depende só da cor. */
export const PROJECT_STATUS: Record<ProjectStatus, { label: string; variant: Variant }> = {
  draft: { label: 'Rascunho', variant: 'neutral' },
  active: { label: '● Ativo', variant: 'active' },
  closing: { label: '◐ Encerrando', variant: 'pending' },
  closed: { label: 'Encerrado', variant: 'archived' },
};

export const TASK_STATUS: Record<TaskStatus, { label: string; variant: Variant }> = {
  proposed: { label: '? Proposta', variant: 'info' },
  open: { label: '◷ Aberta', variant: 'neutral' },
  done: { label: '✓ Feita', variant: 'active' },
  cancelled: { label: 'Descartada', variant: 'archived' },
};

export const EXPENSE_STATUS: Record<ExpenseStatus, { label: string; variant: Variant }> = {
  proposed: { label: '? A validar', variant: 'info' },
  confirmed: { label: '◷ Confirmada', variant: 'pending' },
  paid: { label: '● Paga', variant: 'active' },
  rejected: { label: 'Rejeitada', variant: 'archived' },
};
