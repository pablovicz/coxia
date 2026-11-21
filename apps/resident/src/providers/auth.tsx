import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type MeResponse, tokenStore, UNAUTHORIZED_EVENT } from '@/lib/api';

interface AuthContextValue {
  me: MeResponse | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  /** Troca o token da sessão (a api emite um novo ao trocar a senha). */
  replaceToken: (token: string) => void;
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
    const res = await api<{ accessToken: string }>('/resident-auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    tokenStore.set(res.accessToken);
    setToken(res.accessToken);
  }, []);

  const replaceToken = useCallback((next: string) => {
    tokenStore.set(next);
    setToken(next);
  }, []);

  const logout = useCallback(() => {
    tokenStore.set(null);
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

/** Fuso da casa (horários sempre no fuso da organização, não do celular). */
export function useTimezone(): string {
  return useAuth().me?.organization.timezone ?? 'America/Sao_Paulo';
}
