import { UserAvatar } from './user-avatar';

/** Pessoa da equipe para marcar (participantes, quem recebe o aviso): foto + nome. */
export function MemberCheckbox({
  userId,
  name,
  avatarUpdatedAt,
  label,
  checked,
  onChange,
}: {
  userId: string;
  name: string;
  avatarUpdatedAt?: string | null;
  /** Texto do rótulo (padrão: o nome). */
  label?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
      <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <UserAvatar userId={userId} name={name} version={avatarUpdatedAt} className="size-7 text-[11px]" />
      {label ?? name}
    </label>
  );
}
