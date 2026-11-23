import { Download, Share, SquarePlus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Dialog } from './ui/dialog';

/** Evento do Chrome/Edge/Android que permite abrir a instalação do app (PWA). */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// O navegador pode disparar o evento antes da tela montar: guarda desde o carregamento do módulo.
let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    listeners.forEach((l) => l());
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    listeners.forEach((l) => l());
  });
}

function isStandalone() {
  return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

function isIos() {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Macintosh') && navigator.maxTouchPoints > 1);
}

/**
 * "Instalar app": abre a instalação do navegador (Chrome, Edge, Android) ou, no iPhone/iPad,
 * mostra como adicionar à tela de início. Some quando já está instalado ou não dá para instalar.
 */
export function InstallAppButton({ appName, className }: { appName: string; className?: string }) {
  const [, rerender] = useState(0);
  const [iosHelp, setIosHelp] = useState(false);
  useEffect(() => {
    const l = () => rerender((n) => n + 1);
    listeners.add(l);
    return () => void listeners.delete(l);
  }, []);

  if (typeof window === 'undefined' || isStandalone()) return null;
  const ios = isIos();
  if (!deferred && !ios) return null;

  async function install() {
    if (ios) return setIosHelp(true);
    const e = deferred;
    if (!e) return;
    await e.prompt();
    await e.userChoice.catch(() => undefined);
    deferred = null;
    rerender((n) => n + 1);
  }

  return (
    <>
      <Button type="button" variant="outline" className={cn('w-full', className)} onClick={install}>
        <Download aria-hidden /> Instalar o app
      </Button>
      {iosHelp ? (
        <Dialog open onOpenChange={(v) => !v && setIosHelp(false)} title={`Instalar ${appName}`} description="No iPhone e no iPad, o app é instalado pelo Safari:" footer={<Button onClick={() => setIosHelp(false)}>Entendi</Button>}>
          <ol className="flex flex-col gap-3 text-sm">
            <li className="flex items-center gap-3">
              <Share size={20} aria-hidden className="shrink-0 text-primary" />
              <span>
                1. Toque em <strong>Compartilhar</strong> (o quadrado com a seta, na barra do Safari).
              </span>
            </li>
            <li className="flex items-center gap-3">
              <SquarePlus size={20} aria-hidden className="shrink-0 text-primary" />
              <span>
                2. Escolha <strong>Adicionar à Tela de Início</strong> e toque em <strong>Adicionar</strong>.
              </span>
            </li>
          </ol>
          <p className="mt-4 text-xs text-muted-foreground">Se estiver em outro navegador (Chrome, Instagram, WhatsApp), abra este endereço no Safari antes.</p>
        </Dialog>
      ) : null}
    </>
  );
}
