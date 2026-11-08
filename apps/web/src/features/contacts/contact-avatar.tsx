import { useState } from 'react';
import type { Contact } from '@/lib/api';
import { cn } from '@/lib/utils';

function initials(text: string) {
  const parts = text.replace(/[^\p{L}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  return (parts.length ? parts.slice(0, 2).map((p) => p[0]) : ['#']).join('').toUpperCase();
}

/**
 * Foto do WhatsApp (URL temporária do próprio WhatsApp). Sem foto ou se ela expirou, as iniciais.
 * referrerPolicy no-referrer: o painel não vaza para o WhatsApp de onde a foto foi aberta.
 */
export function ContactAvatar({ contact, size = 44, className }: { contact: Pick<Contact, 'photoUrl' | 'name' | 'whatsappName'>; size?: number; className?: string }) {
  const [broken, setBroken] = useState(false);
  const style = { width: size, height: size };
  if (contact.photoUrl && !broken) {
    return (
      <img
        src={contact.photoUrl}
        alt=""
        aria-hidden
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setBroken(true)}
        style={style}
        className={cn('shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span aria-hidden style={style} className={cn('grid shrink-0 place-items-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground', className)}>
      {initials(contact.name ?? contact.whatsappName ?? '')}
    </span>
  );
}
