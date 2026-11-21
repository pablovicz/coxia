import '@fontsource-variable/dm-sans';
import '@fontsource-variable/fraunces';
import '@fontsource/jetbrains-mono/400.css';
import './styles/index.css';
import { ThemeProvider, useTheme } from '@coxia/ui/providers/theme-provider';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { Toaster } from 'sonner';
import { App } from './App';
import { ApiError } from './lib/api';
import { AuthProvider } from './providers/auth';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Fallback do tempo real: o SSE atualiza na hora; isto cobre conexões que caíram.
      refetchInterval: 120_000,
      refetchOnWindowFocus: true,
      retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 1,
    },
  },
});

function ThemedToaster() {
  const { resolved } = useTheme();
  return <Toaster theme={resolved} position="top-center" richColors />;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
          <ThemedToaster />
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
);
