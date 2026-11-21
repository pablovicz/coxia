import { useQueryClient } from '@tanstack/react-query';
import { type LiveChange, useLiveEvents } from '@coxia/ui/lib/live-events';
import { useAuth } from '@/providers/auth-provider';
import { API_URL, apiSend } from './api';

/**
 * Atualização em tempo real do painel: reservas (inclusive as feitas pelos residentes no
 * workspace ou pelo WhatsApp), contratos, saldo de horas e mensalidades.
 */
export function useLiveUpdates() {
  const qc = useQueryClient();
  const { session } = useAuth();
  const invalidate = (...keys: string[]) => keys.forEach((k) => void qc.invalidateQueries({ queryKey: [k] }));
  useLiveEvents({
    enabled: !!session,
    baseUrl: API_URL,
    getTicket: async () => (await apiSend<{ ticket: string }>('/events/ticket', 'POST')).ticket,
    onReconnect: () => invalidate('bookings', 'overview', 'contracts', 'contract', 'resident'),
    onChange: (e: LiveChange) => {
      switch (e.type) {
        case 'booking.changed':
          invalidate('bookings', 'overview', 'contracts', 'contract', 'resident');
          break;
        case 'hours.changed':
        case 'contract.changed':
          invalidate('contracts', 'contract', 'resident', 'residents');
          break;
        case 'access.changed':
          invalidate('resident-access');
          break;
        case 'income.changed':
          invalidate('incomes', 'finance', 'resident', 'residents', 'overview');
          break;
      }
    },
  });
}
