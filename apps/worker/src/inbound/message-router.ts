/**
 * Decide para onde uma mensagem recebida vai. Função pura: as regras de quem pode o quê
 * ficam explícitas e testáveis, sem IA envolvida.
 */

export type MessageRoute =
  | { route: 'ignored'; reason: 'from_me' | 'status_reply' | 'newsletter' | 'broadcast' | 'reaction' | 'notification' }
  /** Grupo já vinculado a um projeto: alimenta o histórico do projeto. */
  | { route: 'project_group'; projectId: string }
  /** Grupo de um projeto encerrado: o histórico fica, mas mensagens novas não geram eventos. */
  | { route: 'project_closed'; projectId: string }
  /** Grupo com o prefixo de projeto e remetente autorizado: ativa o workspace. */
  | { route: 'project_group_candidate'; authorized: true }
  /** Grupo com o prefixo, mas remetente sem permissão: não cria workspace. */
  | { route: 'project_group_candidate'; authorized: false }
  | { route: 'other_group' }
  /** Conversa direta com admin: comandos de agenda, contas e resumos (Etapa 2). */
  | { route: 'admin_direct' }
  | { route: 'unknown_direct' };

export interface RouteInput {
  kind: string;
  fromMe: boolean;
  isGroup: boolean;
  groupName: string | null;
  senderPhone: string | null;
  flags: { isStatusReply: boolean; isNewsletter: boolean; isBroadcast: boolean };
  /** Projeto já vinculado ao grupo (project_channels), se houver. */
  linkedProject: { id: string; closed: boolean } | null;
  projectGroupPrefix: string;
  /** Telefones (só dígitos) autorizados a criar/encerrar workspaces. */
  projectManagerPhones: ReadonlySet<string>;
  /** Telefones de membros com acesso administrativo. */
  adminPhones: ReadonlySet<string>;
}

/** Compara ignorando caixa, acentos e espaços extras: "Projeto – XPO" ≈ "PROJETO - XPO". */
export function normalizeGroupName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/[‒-―]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

export function matchesProjectPrefix(groupName: string | null, prefix: string): boolean {
  if (!groupName) return false;
  const name = normalizeGroupName(groupName);
  const p = normalizeGroupName(prefix);
  // O prefixo precisa ser seguido de separador: "PROJETO - XPO", "PROJETO: XPO", "PROJETO XPO";
  // mas não "PROJETOS GERAIS".
  return name.startsWith(p) && /^[\s\-:|]+[^\s\-:|]/.test(name.slice(p.length));
}

export function routeMessage(m: RouteInput): MessageRoute {
  if (m.fromMe) return { route: 'ignored', reason: 'from_me' };
  if (m.flags.isStatusReply) return { route: 'ignored', reason: 'status_reply' };
  if (m.flags.isNewsletter) return { route: 'ignored', reason: 'newsletter' };
  if (m.flags.isBroadcast) return { route: 'ignored', reason: 'broadcast' };
  if (m.kind === 'reaction') return { route: 'ignored', reason: 'reaction' };
  if (m.kind === 'notification') return { route: 'ignored', reason: 'notification' };

  if (m.isGroup) {
    if (m.linkedProject) {
      return m.linkedProject.closed
        ? { route: 'project_closed', projectId: m.linkedProject.id }
        : { route: 'project_group', projectId: m.linkedProject.id };
    }
    if (matchesProjectPrefix(m.groupName, m.projectGroupPrefix)) {
      const authorized = m.senderPhone !== null && m.projectManagerPhones.has(m.senderPhone);
      return authorized
        ? { route: 'project_group_candidate', authorized: true }
        : { route: 'project_group_candidate', authorized: false };
    }
    return { route: 'other_group' };
  }

  return m.senderPhone !== null && m.adminPhones.has(m.senderPhone) ? { route: 'admin_direct' } : { route: 'unknown_direct' };
}
