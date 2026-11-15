import { useQuery } from '@tanstack/react-query';
import { FolderKanban, Search, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, type ProjectListItem } from '@/lib/api';
import { cn } from '@/lib/utils';

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();

export const useProjects = () => useQuery({ queryKey: ['projects'], queryFn: () => api<ProjectListItem[]>('/projects') });

/**
 * Busca e escolhe um projeto (por nome, sem acento). Os encerrados aparecem depois dos ativos.
 * `value` null = nenhum; o rótulo vazio diz o que "nenhum" significa ("Sem projeto", "Todos os projetos").
 */
export function ProjectPicker({
  value,
  onChange,
  label,
  emptyLabel = 'Sem projeto',
  className,
}: {
  value: string | null;
  onChange: (id: string | null) => void;
  label: string;
  emptyLabel?: string;
  className?: string;
}) {
  const projects = useProjects();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const id = useId();
  const selected = projects.data?.find((p) => p.id === value) ?? null;
  const results = useMemo(() => {
    const term = normalize(q.trim());
    return [...(projects.data ?? [])]
      .filter((p) => !term || normalize(p.title).includes(term) || normalize(p.groupName ?? '').includes(term))
      .sort((a, b) => Number(a.status === 'closed') - Number(b.status === 'closed') || a.title.localeCompare(b.title, 'pt-BR'))
      .slice(0, 8);
  }, [projects.data, q]);

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {selected ? (
        <div className="flex min-h-11 items-center justify-between gap-2 rounded-sm border bg-muted/40 pl-3">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <FolderKanban size={16} aria-hidden className="shrink-0 text-muted-foreground" />
            <span className="truncate font-medium">{selected.title}</span>
          </span>
          <Button type="button" variant="ghost" size="icon" aria-label={`Tirar o projeto ${selected.title}`} onClick={() => onChange(null)}>
            <X aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Search size={16} aria-hidden className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            id={id}
            role="combobox"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            value={q}
            placeholder={`${emptyLabel} · buscar projeto`}
            className="pl-9"
            onChange={(e) => {
              setQ(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            // Atraso: deixa o clique na opção acontecer antes de fechar.
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
              if (e.key === 'Enter' && open && results[0]) {
                e.preventDefault();
                onChange(results[0].id);
                setQ('');
                setOpen(false);
              }
            }}
          />
          {open ? (
            <ul id={`${id}-list`} role="listbox" aria-label="Projetos" className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 shadow-md">
              {projects.isPending ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">Carregando…</li>
              ) : results.length === 0 ? (
                <li className="px-3 py-2 text-sm text-muted-foreground">Nenhum projeto encontrado</li>
              ) : (
                results.map((p) => (
                  <li key={p.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onChange(p.id);
                        setQ('');
                        setOpen(false);
                      }}
                      className="flex min-h-11 w-full items-center justify-between gap-2 rounded-sm px-3 text-left text-sm hover:bg-muted"
                    >
                      <span className="truncate">{p.title}</span>
                      {p.status === 'closed' ? <span className="shrink-0 text-xs text-muted-foreground">encerrado</span> : null}
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>
      )}
    </div>
  );
}
