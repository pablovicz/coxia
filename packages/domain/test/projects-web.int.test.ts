/**
 * Projeto criado pelo painel: título sem o prefixo, nome do grupo no padrão, administradoras
 * que entram no grupo e o vínculo do grupo criado pela Coxia.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, DomainError, ProjectService } from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const projects = new ProjectService(db);
const suffix = String(Date.now()).slice(-7);
const ANA = `551193${suffix}`;
const COXIA = `551190${suffix}`;
let orgId: string;
let instanceId: string;

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Projetos Web', slug: `pw-${randomUUID()}` } })).id;
  instanceId = (await db.whatsappInstance.create({ data: { organizationId: orgId, provider: 'fake', externalInstanceId: randomUUID(), phone: COXIA, connected: true } })).id;
  const mk = async (name: string, phone: string | null, role: 'owner' | 'admin' | 'staff') => {
    const u = await db.user.create({ data: { name: `${name} ${suffix}`, phone } });
    await db.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role } });
  };
  await mk('Ana', ANA, 'owner');
  await mk('Julia', null, 'admin');
  await mk('Bruno', `551194${suffix}`, 'staff');
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { name: { endsWith: suffix } } });
  await db.$disconnect();
});

describe('projeto pelo painel', () => {
  it('título sem o prefixo, grupo no padrão "PROJETO - Nome"; nome repetido em andamento é conflito', async () => {
    const { project, groupName } = await projects.createFromWeb(orgId, { title: 'projeto - Mostra de Inverno', objective: 'Mostra dos alunos', estimatedBudgetCents: 1200000 }, actor);
    expect(project).toMatchObject({ title: 'Mostra de Inverno', status: 'active', objective: 'Mostra dos alunos', estimatedBudgetCents: 1200000 });
    expect(groupName).toBe('PROJETO - Mostra de Inverno');
    await expectDomainError(projects.createFromWeb(orgId, { title: 'mostra de inverno' }, actor), 'conflict');
    await expectDomainError(projects.createFromWeb(orgId, { title: 'PROJETO - ' }, actor), 'validation');
  });

  it('administradoras com telefone entram (sem a Coxia); quem não tem telefone fica de fora; equipe comum não entra', async () => {
    const { phones, withoutPhone } = await projects.adminPhones(orgId, COXIA);
    expect(phones).toEqual([ANA]);
    expect(withoutPhone).toEqual([`Julia ${suffix}`]);
  });

  it('grupo criado pela Coxia fica ligado ao projeto (um só)', async () => {
    const { project } = await projects.createFromWeb(orgId, { title: 'Sarau' }, actor);
    const { group, channel } = await projects.linkCreatedGroup(orgId, project.id, { instanceId, externalGroupId: `${randomUUID()}-group`, name: 'PROJETO - Sarau' }, actor);
    expect(group.name).toBe('PROJETO - Sarau');
    expect(channel.projectId).toBe(project.id);
    await expectDomainError(projects.linkCreatedGroup(orgId, project.id, { instanceId, externalGroupId: `${randomUUID()}-group`, name: 'PROJETO - Sarau' }, actor), 'conflict');
  });
});
