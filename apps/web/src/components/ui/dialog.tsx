import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';

/**
 * Diálogo acessível (Radix). No celular abre como folha inferior (Sheet);
 * a partir de 640px, centralizado.
 */
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'default',
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** wide: formulários longos em duas colunas no desktop. */
  size?: 'default' | 'wide';
}) {
  // Diálogos controlados (sem DialogTrigger): o Radix não sabe para onde devolver o foco.
  // Guardamos o elemento focado na abertura — antes do foco ir para dentro do diálogo.
  const returnFocus = useRef<HTMLElement | null>(null);
  if (open && returnFocus.current === null && typeof document !== 'undefined') {
    returnFocus.current = document.activeElement as HTMLElement | null;
  }
  if (!open) returnFocus.current = null;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/40" />
        <DialogPrimitive.Content
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            returnFocus.current?.focus();
          }}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex max-h-[92dvh] flex-col rounded-t-xl border bg-popover text-popover-foreground shadow-popover',
            'sm:inset-x-auto sm:bottom-auto sm:left-1/2 sm:top-1/2 sm:w-[calc(100%-2rem)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
            size === 'wide' ? 'sm:max-w-2xl lg:max-w-5xl' : 'sm:max-w-lg',
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b p-5">
            <div>
              <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
              {description ? (
                <DialogPrimitive.Description className="mt-1 text-sm text-muted-foreground">{description}</DialogPrimitive.Description>
              ) : (
                <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
              )}
            </div>
            <DialogPrimitive.Close className="-m-2 grid size-11 place-items-center rounded-md hover:bg-muted" aria-label="Fechar">
              <X size={18} aria-hidden />
            </DialogPrimitive.Close>
          </div>
          <div className="overflow-y-auto p-5">{children}</div>
          {footer ? <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">{footer}</div> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
