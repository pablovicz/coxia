import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, type SessionInfo, tokenStore } from '@/lib/api';

interface AuthContextValue {
  session: SessionInfo | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => tokenStore.get());

  const me = useQuery({
    queryKey: ['auth', 'me', token],
    queryFn: () => api<SessionInfo>('/auth/me'),
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60_000,
  });

  useEffect(() => {
    const onUnauthorized = () => setToken(null);
    window.addEventListener('coxia:unauthorized', onUnauthorized);
    return () => window.removeEventListener('coxia:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api<{ accessToken: string }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    tokenStore.set(res.accessToken);
    setToken(res.accessToken);
  }, []);

  const logout = useCallback(() => {
    tokenStore.set(null);
    setToken(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ session: token ? (me.data ?? null) : null, loading: !!token && me.isPending, login, logout }),
    [token, me.data, me.isPending, login, logout],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth precisa de <AuthProvider>');
  return ctx;
}
