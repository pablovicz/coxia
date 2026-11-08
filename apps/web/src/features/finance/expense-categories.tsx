import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus } from 'lucide-react';
import { type FormEvent, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api, apiSend, type ExpenseCategory, type ExpenseCategoryRef } from '@/lib/api';
import { CategoryIcon, EXPENSE_ICONS } from '@/lib/expense-categories';
import { ROOM_COLORS, roomStyle } from '@/lib/rooms';
import { cn } from '@/lib/utils';

export const useExpenseCategories = () => useQuery({ queryKey: ['expense-categories'], queryFn: () => api<ExpenseCategory[]>('/expense-categories') });

/** Selo da categoria: ícone na cor dela + nome. */
export function CategoryBadge({ category, className }: { category: ExpenseCategoryRef | null | undefined; className?: string }) {
  if (!category) return null;
  return (
    <span style={roomStyle(category.color)} className={cn('room-soft inline-flex min-w-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', className)}>
      <CategoryIcon icon={category.icon} size={12} className="room-text shrink-0" />
      <span className="truncate">{category.name}</span>
    </span>
  );
}

/** Lista e cadastro das categorias de gasto (nome, ícone e cor). */
export function ExpenseCategoriesDialog({ onClose }: { onClose: () => void }) {
  const categories = useExpenseCategories();
  const [editing, setEditing] = useState<ExpenseCategory | 'new' | null>(null);
  if (editing) return <CategoryForm category={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />;
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title="Categorias de gasto"
      description="Caracterizam cada conta: Casa (aluguel, internet, luz), Estoque, Manutenção…"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Fechar
          </Button>
          <Button onClick={() => setEditing('new')}>
            <Plus aria-hidden /> Nova categoria
          </Button>
        </>
      }
    >
      <ul className="divide-y">
        {(categories.data ?? []).map((c) => (
          <li key={c.id} style={roomStyle(c.color)} className="flex min-h-14 items-center gap-3 py-2">
            <span className="room-soft grid size-10 shrink-0 place-items-center rounded-full">
              <CategoryIcon icon={c.icon} size={18} className="room-text" />
            </span>
            <span className="min-w-0 flex-1 truncate font-medium">{c.name}</span>
            <Button variant="ghost" size="sm" onClick={() => setEditing(c)} aria-label={`Editar ${c.name}`}>
              <Pencil aria-hidden /> <span className="hidden sm:inline">Editar</span>
            </Button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

function CategoryForm({ category, onClose }: { category: ExpenseCategory | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [name, setName] = useState(category?.name ?? '');
  const [icon, setIcon] = useState(category?.icon ?? 'outros');
  const [color, setColor] = useState(category?.color ?? 'grafite');
  const [error, setError] = useState<string | null>(null);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['expense-categories'] });
    qc.invalidateQueries({ queryKey: ['bills'] });
  };
  const save = useMutation({
    mutationFn: () =>
      category ? apiSend(`/expense-categories/${category.id}`, 'PATCH', { name: name.trim(), icon, color }) : apiSend('/expense-categories', 'POST', { name: name.trim(), icon, color }),
    onSuccess: () => {
      invalidate();
      toast.success(category ? 'Categoria atualizada.' : 'Categoria criada.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  const archive = useMutation({
    mutationFn: () => apiSend(`/expense-categories/${category!.id}`, 'PATCH', { active: false }),
    onSuccess: () => {
      invalidate();
      toast.success('Categoria arquivada. As contas dela continuam como estão.');
      onClose();
    },
    onError: (e) => setError(e.message),
  });
  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError('Informe o nome da categoria.');
    save.mutate();
  }
  return (
    <Dialog
      open
      onOpenChange={(v) => !v && onClose()}
      title={category ? `Editar ${category.name}` : 'Nova categoria'}
      footer={
        <>
          {category ? (
            <Button variant="ghost" className="text-destructive sm:mr-auto" loading={archive.isPending} onClick={() => archive.mutate()}>
              Arquivar
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Voltar
          </Button>
          <Button type="submit" form="category-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="category-form" onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Field label="Nome">{(id) => <Input id={id} value={name} maxLength={60} placeholder="Ex.: Estoque" onChange={(e) => setName(e.target.value)} />}</Field>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Cor</legend>
          <div role="radiogroup" aria-label="Cor" className="flex flex-wrap gap-2">
            {(Object.keys(ROOM_COLORS) as Array<keyof typeof ROOM_COLORS>).map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={ROOM_COLORS[c]}
                onClick={() => setColor(c)}
                style={roomStyle(c)}
                className={cn('grid size-11 place-items-center rounded-full', color === c && 'room-ring')}
              >
                <span className="room-fill block size-8 rounded-full" />
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-1.5 text-sm font-medium">Ícone</legend>
          <div role="radiogroup" aria-label="Ícone" className="grid grid-cols-6 gap-1.5" style={roomStyle(color)}>
            {Object.entries(EXPENSE_ICONS).map(([key, { label }]) => (
              <button
                key={key}
                type="button"
                role="radio"
                aria-checked={icon === key}
                aria-label={label}
                title={label}
                onClick={() => setIcon(key)}
                className={cn(
                  'grid min-h-11 place-items-center rounded-md border',
                  icon === key ? 'room-soft room-text border-transparent ring-2 ring-[var(--room)]' : 'text-muted-foreground hover:bg-muted',
                )}
              >
                <CategoryIcon icon={key} size={20} strokeWidth={1.75} />
              </button>
            ))}
          </div>
        </fieldset>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
