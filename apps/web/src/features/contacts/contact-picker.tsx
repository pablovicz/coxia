import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { api, type Contact } from '@/lib/api';
import { formatPhone } from '@/lib/format';

/** Busca nos Contatos (nome sem acento ou trecho do telefone). */
export function ContactPicker({ onPick, inputId = 'contact-picker' }: { onPick: (c: Contact) => void; inputId?: string }) {
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const results = useQuery({
    queryKey: ['contacts', 'pick', debounced],
    queryFn: () => api<{ items: Contact[] }>(`/contacts?limit=6&q=${encodeURIComponent(debounced)}`),
    enabled: debounced.length >= 2,
  });
  return (
    <div>
      <div className="relative">
        <label htmlFor={inputId} className="sr-only">
          Buscar contato
        </label>
        <Search size={18} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input id={inputId} type="search" className="pl-10" placeholder="Buscar contato por nome ou telefone" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      {debounced.length >= 2 ? (
        <ul className="mt-1 divide-y rounded-md border" aria-label="Contatos encontrados">
          {results.data?.items.length === 0 ? <li className="px-3 py-2.5 text-sm text-muted-foreground">Nenhum contato encontrado.</li> : null}
          {(results.data?.items ?? []).map((c) => (
            <li key={c.id}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-muted" onClick={() => onPick(c)}>
                <span className="truncate font-medium">{c.name ?? c.whatsappName ?? formatPhone(c.phone)}</span>
                <span className="tabular shrink-0 text-sm text-muted-foreground">{formatPhone(c.phone)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
