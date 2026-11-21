import { Skeleton } from '@coxia/ui/components/ui/input';
import type { ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Shell } from './components/shell';
import { BookPage } from './features/book-page';
import { BookingsPage } from './features/bookings-page';
import { CheckInPage } from './features/check-in-page';
import { ContractPage } from './features/contract-page';
import { ChangePasswordPage, ForgotPasswordPage, LoginPage, SetPasswordPage } from './features/auth-pages';
import { HomePage } from './features/home-page';
import { PaymentsPage } from './features/payments-page';
import { RoomCheckInPage } from './features/room-check-in-page';
import { useAuth } from './providers/auth';

/** Sem sessão: vai para o login e volta para onde estava (link do e-mail, QR da sala). */
function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-4 p-6" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!me) return <Navigate to={`/entrar?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  // Senha provisória: troca antes de qualquer outra tela (depois segue para onde ia: QR, link...).
  if (me.mustChangePassword) return <ChangePasswordPage />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route path="/esqueci-senha" element={<ForgotPasswordPage />} />
      <Route path="/definir-senha" element={<SetPasswordPage />} />
      <Route
        element={
          <RequireAuth>
            <Shell />
          </RequireAuth>
        }
      >
        <Route index element={<HomePage />} />
        <Route path="reservar" element={<BookPage />} />
        <Route path="reservas" element={<BookingsPage />} />
        <Route path="reservas/:id/check-in" element={<CheckInPage />} />
        <Route path="sala/:spaceId" element={<RoomCheckInPage />} />
        <Route path="contratos/:id" element={<ContractPage />} />
        <Route path="pagamentos" element={<PaymentsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
