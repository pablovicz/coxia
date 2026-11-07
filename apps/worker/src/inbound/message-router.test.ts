import { describe, expect, it } from 'vitest';
import { matchesProjectPrefix, routeMessage, type RouteInput } from './message-router';

const base: RouteInput = {
  kind: 'text',
  fromMe: false,
  isGroup: true,
  groupName: 'PROJETO - XPO',
  senderPhone: '5511977776666',
  flags: { isStatusReply: false, isNewsletter: false, isBroadcast: false },
  linkedProject: null,
  projectGroupPrefix: 'PROJETO',
  projectManagerPhones: new Set(['5511977776666']),
  adminPhones: new Set(['5511977776666']),
};

describe('matchesProjectPrefix', () => {
  it.each([
    ['PROJETO - XPO', true],
    ['Projeto – XPO', true],
    ['projeto: Festival', true],
    ['PROJETO XPO', true],
    ['  PROJETO   -   XPO ', true],
    ['PROJETOS GERAIS', false],
    ['PROJETO', false],
    ['PROJETO - ', false],
    ['Equipe Casa Kaju', false],
  ])('%s → %s', (name, expected) => {
    expect(matchesProjectPrefix(name, 'PROJETO')).toBe(expected);
  });
});

describe('golden: routeMessage', () => {
  it('admin autorizado em grupo PROJETO - XPO pode ativar workspace', () => {
    expect(routeMessage(base)).toEqual({ route: 'project_group_candidate', authorized: true });
  });

  it('participante sem permissão não ativa workspace', () => {
    expect(routeMessage({ ...base, senderPhone: '5511900001111' })).toEqual({ route: 'project_group_candidate', authorized: false });
  });

  it('grupo já vinculado vai para o projeto, mesmo após renomeação', () => {
    expect(routeMessage({ ...base, groupName: 'Outro nome', linkedProject: { id: 'p1', closed: false } })).toEqual({ route: 'project_group', projectId: 'p1' });
  });

  it('grupo de projeto encerrado não reabre nem cria outro workspace', () => {
    expect(routeMessage({ ...base, linkedProject: { id: 'p1', closed: true } })).toEqual({ route: 'project_closed', projectId: 'p1' });
  });

  it('mensagens da própria Coxia (fromMe) são ignoradas', () => {
    expect(routeMessage({ ...base, fromMe: true })).toEqual({ route: 'ignored', reason: 'from_me' });
  });

  it('reações e notificações não viram eventos', () => {
    expect(routeMessage({ ...base, kind: 'reaction' }).route).toBe('ignored');
    expect(routeMessage({ ...base, kind: 'notification' }).route).toBe('ignored');
  });

  it('grupo sem prefixo é outro grupo', () => {
    expect(routeMessage({ ...base, groupName: 'Equipe' })).toEqual({ route: 'other_group' });
  });

  it('conversa direta: admin vs desconhecido', () => {
    const direct = { ...base, isGroup: false, groupName: null };
    expect(routeMessage(direct)).toEqual({ route: 'admin_direct' });
    expect(routeMessage({ ...direct, senderPhone: '5511900001111' })).toEqual({ route: 'unknown_direct' });
    expect(routeMessage({ ...direct, senderPhone: null })).toEqual({ route: 'unknown_direct' });
  });
});
