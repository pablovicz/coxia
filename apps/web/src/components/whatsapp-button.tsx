import { cn } from '@coxia/ui/lib/utils';

/** Logo do WhatsApp (o lucide não tem ícones de marca). */
export function WhatsappIcon({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden className={className}>
      <path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.27-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.17-.17.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.48-.89-.79-1.49-1.77-1.66-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.52.15-.17.2-.3.3-.5.1-.2.05-.37-.02-.52-.08-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.04 1.02-1.04 2.48s1.07 2.88 1.21 3.08c.15.2 2.1 3.2 5.08 4.49.71.31 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.08 1.76-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35ZM12.04 21.5h-.01a9.45 9.45 0 0 1-4.82-1.32l-.35-.2-3.58.94.96-3.49-.23-.36a9.43 9.43 0 0 1-1.45-5.03c0-5.22 4.25-9.47 9.48-9.47 2.53 0 4.91.99 6.7 2.78a9.4 9.4 0 0 1 2.77 6.7c0 5.23-4.25 9.48-9.47 9.48Zm8.07-17.55A11.33 11.33 0 0 0 12.04.6C5.75.6.63 5.72.63 12.01c0 2.01.53 3.97 1.52 5.7L.54 23.6l6.04-1.58a11.4 11.4 0 0 0 5.45 1.39h.01c6.29 0 11.41-5.12 11.41-11.41 0-3.05-1.19-5.91-3.34-8.06Z" />
    </svg>
  );
}

/** Abre a conversa no WhatsApp (wa.me/<número com DDI, só dígitos>). */
export function WhatsappButton({ phone, className }: { phone: string | null | undefined; className?: string }) {
  const digits = (phone ?? '').replace(/\D/g, '');
  if (!digits) return null;
  return (
    <a
      href={`https://wa.me/${digits}`}
      target="_blank"
      rel="noreferrer"
      aria-label="Abrir conversa no WhatsApp"
      title="Abrir no WhatsApp"
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-[#1fa855] transition-colors hover:bg-[#25d366]/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring dark:text-[#25d366]',
        className,
      )}
    >
      <WhatsappIcon size={20} />
    </a>
  );
}
