import {
  BriefcaseBusiness,
  Car,
  House,
  Landmark,
  type LucideIcon,
  type LucideProps,
  Megaphone,
  Package,
  Speaker,
  Tag,
  Ticket,
  Users,
  UtensilsCrossed,
  Wrench,
} from 'lucide-react';

/** Mesmas chaves de EXPENSE_ICONS no domínio (packages/domain/src/expense-categories.ts). */
export const EXPENSE_ICONS: Record<string, { label: string; Icon: LucideIcon }> = {
  casa: { label: 'Casa', Icon: House },
  estoque: { label: 'Estoque', Icon: Package },
  manutencao: { label: 'Manutenção', Icon: Wrench },
  servicos: { label: 'Serviços', Icon: BriefcaseBusiness },
  equipamento: { label: 'Equipamento', Icon: Speaker },
  alimentacao: { label: 'Alimentação', Icon: UtensilsCrossed },
  transporte: { label: 'Transporte', Icon: Car },
  marketing: { label: 'Divulgação', Icon: Megaphone },
  pessoal: { label: 'Pessoal', Icon: Users },
  impostos: { label: 'Impostos e taxas', Icon: Landmark },
  eventos: { label: 'Eventos', Icon: Ticket },
  outros: { label: 'Outros', Icon: Tag },
};

export function CategoryIcon({ icon, ...props }: { icon: string | null | undefined } & LucideProps) {
  const Icon = (icon && EXPENSE_ICONS[icon]?.Icon) || Tag;
  return <Icon aria-hidden {...props} />;
}
