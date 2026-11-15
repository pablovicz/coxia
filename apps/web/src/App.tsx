import { Navigate, Outlet, Route, Routes } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { Skeleton } from '@/components/ui/input';
import { LoginPage } from '@/features/auth/login-page';
import { HomePage } from '@/features/dashboard/home-page';
import { ProjectDetailPage } from '@/features/projects/project-detail-page';
import { ProjectsPage } from '@/features/projects/projects-page';
import { ContactsPage } from '@/features/contacts/contacts-page';
import { BillsPage } from '@/features/reminders/bills-page';
import { FinanceOverviewPage } from '@/features/finance/finance-overview';
import { ResidentDetailPage } from '@/features/residents/resident-detail-page';
import { ResidentsPage } from '@/features/residents/residents-page';
import { TeamCalendarPage } from '@/features/calendar/team-calendar-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { AgendaPage } from '@/features/rooms/agenda-page';
import { RoomsPage } from '@/features/rooms/rooms-page';
import { useAuth } from '@/providers/auth-provider';

function RequireAuth() {
  const { session, loading } = useAuth();
  if (loading) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-3 p-10" aria-busy="true" aria-label="Carregando">
        <Skeleton className="h-10" />
        <Skeleton className="h-24" />
      </div>
    );
  }
  return session ? <Outlet /> : <Navigate to="/entrar" replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/entrar" element={<LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<HomePage />} />
          <Route path="projetos" element={<ProjectsPage />} />
          <Route path="projetos/:id" element={<ProjectDetailPage />} />
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="salas" element={<RoomsPage />} />
          <Route path="contas" element={<FinanceOverviewPage />} />
          <Route path="contas/:competence" element={<BillsPage />} />
          <Route path="lembretes" element={<TeamCalendarPage />} />
          <Route path="calendario" element={<TeamCalendarPage mode="calendario" />} />
          <Route path="residentes" element={<ResidentsPage />} />
          <Route path="residentes/:id" element={<ResidentDetailPage />} />
          <Route path="contatos" element={<ContactsPage />} />
          <Route path="configuracoes" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
