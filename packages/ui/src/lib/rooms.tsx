import {
  Armchair,
  BookOpen,
  Camera,
  Coffee,
  DoorOpen,
  Drama,
  type LucideIcon,
  type LucideProps,
  Mic,
  Music,
  Palette,
  Piano,
  Presentation,
  Sparkles,
  Sprout,
  Users,
} from 'lucide-react';
import type { CSSProperties } from 'react';

/** Mesmas chaves de SPACE_COLORS / SPACE_ICONS no domínio (packages/domain/src/spaces.ts). */
export const ROOM_COLORS = {
  floresta: 'Floresta',
  terracota: 'Terracota',
  azul: 'Azul',
  mostarda: 'Mostarda',
  ameixa: 'Ameixa',
  petroleo: 'Petróleo',
  rosa: 'Rosa',
  grafite: 'Grafite',
} as const;
export type RoomColor = keyof typeof ROOM_COLORS;

export const ROOM_ICONS: Record<string, { label: string; Icon: LucideIcon }> = {
  palco: { label: 'Palco', Icon: Drama },
  musica: { label: 'Música', Icon: Music },
  poltrona: { label: 'Poltrona', Icon: Armchair },
  paleta: { label: 'Artes', Icon: Palette },
  microfone: { label: 'Microfone', Icon: Mic },
  camera: { label: 'Câmera', Icon: Camera },
  pessoas: { label: 'Pessoas', Icon: Users },
  porta: { label: 'Porta', Icon: DoorOpen },
  livro: { label: 'Livro', Icon: BookOpen },
  apresentacao: { label: 'Apresentação', Icon: Presentation },
  piano: { label: 'Piano', Icon: Piano },
  cafe: { label: 'Café', Icon: Coffee },
  jardim: { label: 'Jardim', Icon: Sprout },
  estrela: { label: 'Estrela', Icon: Sparkles },
};

export type RoomStatus = 'available' | 'unavailable' | 'monthly_rental';

export const ROOM_STATUS: Record<RoomStatus, { label: string; hint: string; badge: 'active' | 'late' | 'info' }> = {
  available: { label: 'Disponível', hint: 'Aparece na agenda e recebe reservas', badge: 'active' },
  unavailable: { label: 'Não disponível', hint: 'Fechada para reservas (reforma, uso interno)', badge: 'late' },
  monthly_rental: { label: 'Alugada mensal', hint: 'Ocupada por aluguel mensal; sem reservas avulsas', badge: 'info' },
};

/** Define --room no elemento; as utilidades room-bar/room-soft/room-fill/room-text usam essa cor. */
export function roomStyle(color: string | null | undefined): CSSProperties {
  const key = color && color in ROOM_COLORS ? color : 'floresta';
  return { '--room': `var(--room-${key})` } as CSSProperties;
}

export function RoomIcon({ icon, ...props }: { icon: string | null | undefined } & LucideProps) {
  const Icon = (icon && ROOM_ICONS[icon]?.Icon) || DoorOpen;
  return <Icon aria-hidden {...props} />;
}
