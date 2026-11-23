import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, client, type MeResponse, type SessionTokens, tokenStore, UNAUTHORIZED_EVENT } from '@/lib/api';

interface AuthContextValue {
  me: MeResponse | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Troca a sessão (a api abre uma nova ao trocar a senha). */
  replaceToken: (tokens: SessionTokens) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => tokenStore.get());

  const me = useQuery({
    queryKey: ['me', token],
    queryFn: () => api<MeResponse>('/me'),
    enabled: !!token,
    retry: false,
    staleTime: 30_000,
  });

  useEffect(() => {
    const onUnauthorized = () => setToken(null);
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<SessionTokens>('/resident-auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    tokenStore.setSession(res);
    setToken(res.accessToken);
  }, []);

  const replaceToken = useCallback((next: SessionTokens) => {
    tokenStore.setSession(next);
    setToken(next.accessToken);
  }, []);

  const logout = useCallback(() => {
    client.logout();
    setToken(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ me: token ? (me.data ?? null) : null, loading: !!token && me.isPending, login, logout, replaceToken }),
    [token, me.data, me.isPending, login, logout, replaceToken],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa de <AuthProvider>');
  return ctx;
}

/** Check-in (link do convite e QR da sala) ligado nesta instalação? */
export function useCheckInEnabled(): boolean {
  return useAuth().me?.features?.checkIn ?? false;
}

/** Fuso da casa (horários sempre no fuso da organização, não do celular). */
export function useTimezone(): string {
  return useAuth().me?.organization.timezone ?? 'America/Sao_Paulo';
}
