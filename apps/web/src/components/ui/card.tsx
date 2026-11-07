import type { HTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border bg-card text-card-foreground shadow-card', className)} {...props} />;
}

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn('text-base font-semibold leading-tight', className)} {...props} />;
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-5 pt-0', className)} {...props} />;
}

/** Card métrico: título, número e legenda. */
export function MetricCard({
  title,
  value,
  caption,
  highlight,
}: {
  title: string;
  value: string;
  caption: string;
  highlight?: boolean;
}) {
  return (
    <Card className={cn('p-5', highlight && 'border-transparent bg-primary text-primary-foreground')}>
      <p className={cn('text-sm font-medium', highlight ? 'opacity-85' : 'text-muted-foreground')}>{title}</p>
      <p className="tabular mt-2 text-[32px] font-semibold leading-none tracking-tight">{value}</p>
      <p className={cn('mt-2 text-[13px]', highlight ? 'opacity-85' : 'text-muted-foreground')}>{caption}</p>
    </Card>
  );
}
