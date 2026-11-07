import { Monitor, Moon, Sun } from 'lucide-react';
import { type ThemePreference, useTheme } from '@/providers/theme-provider';
import { cn } from '@/lib/utils';

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Claro', icon: Sun },
  { value: 'dark', label: 'Escuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

export function ThemeSwitch({ className }: { className?: string }) {
  const { preference, setPreference } = useTheme();
  return (
    <div role="radiogroup" aria-label="Tema" className={cn('inline-flex rounded-md border bg-card p-1', className)}>
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={preference === value}
          aria-label={label}
          title={label}
          onClick={() => setPreference(value)}
          className={cn(
            'grid size-11 place-items-center rounded-sm text-muted-foreground transition-colors lg:size-9',
            preference === value && 'bg-muted text-foreground',
          )}
        >
          <Icon size={18} strokeWidth={1.75} aria-hidden />
        </button>
      ))}
    </div>
  );
}
