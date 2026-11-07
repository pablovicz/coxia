import { Navigate, Outlet, Route, Routes } from 'react-router';
import { AppShell } from '@/components/layout/app-shell';
import { Skeleton } from '@/components/ui/input';
import { LoginPage } from '@/features/auth/login-page';
import { HomePage } from '@/features/dashboard/home-page';
import { AgendaPage, BillsPage, ProjectsPage, SettingsPage } from '@/features/placeholder-pages';
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
          <Route path="agenda" element={<AgendaPage />} />
          <Route path="contas" element={<BillsPage />} />
          <Route path="configuracoes" element={<SettingsPage />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
