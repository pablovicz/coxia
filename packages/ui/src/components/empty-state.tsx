import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center rounded-lg border border-dashed px-6 py-10 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-full bg-secondary text-secondary-foreground">
        <Icon size={20} strokeWidth={1.75} aria-hidden />
      </div>
      <h3 className="font-semibold">{title}</h3>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}

/** Cabeçalho editorial de página: sobretítulo, título em Fraunces e descrição. */
export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">{eyebrow}</p>
        <h1 className="mt-1 font-display text-[28px] font-semibold leading-tight tracking-tight sm:text-[40px]">
          {title}
        </h1>
        <p className="mt-1 text-muted-foreground">{description}</p>
      </div>
      {action}
    </header>
  );
}
