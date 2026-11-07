import { cva, type VariantProps } from 'class-variance-authority';
import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

/** Status sempre legível por texto — a cor nunca é o único indicador. */
const badgeVariants = cva('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', {
  variants: {
    variant: {
      neutral: 'bg-muted text-muted-foreground',
      active: 'bg-success/15 text-success',
      pending: 'bg-accent/30 text-accent-foreground dark:text-warning',
      late: 'bg-destructive/12 text-destructive',
      archived: 'border border-border text-muted-foreground',
      info: 'bg-info/12 text-info',
    },
  },
  defaultVariants: { variant: 'neutral' },
});

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
