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

describe('documentos do projeto', () => {
  it('anexa documento, croqui e comprovante; lista por tipo; remove e devolve a chave do arquivo', async () => {
    const { project } = await projects.createFromWeb(orgId, { title: 'Mostra de Inverno 2' }, actor);
    const add = (kind: 'document' | 'sketch' | 'receipt', fileName: string) =>
      projects.addDocument(orgId, project.id, { kind, fileName, contentType: 'application/pdf', sizeBytes: 1000, storageKey: `k/${fileName}` }, actor);
    await add('document', 'rider.pdf');
    const sketch = await add('sketch', 'croqui-palco.pdf');
    await add('receipt', 'comprovante-grafica.pdf');
    const docs = await projects.listDocuments(orgId, project.id);
    expect(docs.map((d) => [d.kind, d.fileName])).toEqual([
      ['document', 'rider.pdf'],
      ['sketch', 'croqui-palco.pdf'],
      ['receipt', 'comprovante-grafica.pdf'],
    ]);
    expect(await projects.removeDocument(orgId, project.id, sketch.id, actor)).toEqual({ storageKey: 'k/croqui-palco.pdf' });
    expect(await projects.listDocuments(orgId, project.id)).toHaveLength(2);
    await expectDomainError(projects.getDocument(orgId, project.id, sketch.id), 'not_found');
  });
});

describe('data de início e exclusão', () => {
  it('data de início na criação e na edição; data inválida é recusada; vazio limpa', async () => {
    const { project } = await projects.createFromWeb(orgId, { title: 'Festival de Verão', startsOn: '2026-12-01' }, actor);
    expect((await projects.detail(orgId, project.id)).startsOn).toBe('2026-12-01');
    expect((await projects.list(orgId)).find((p) => p.id === project.id)?.startsOn).toBe('2026-12-01');
    await projects.update(orgId, project.id, { startsOn: null }, actor);
    expect((await projects.detail(orgId, project.id)).startsOn).toBeNull();
    await expectDomainError(projects.update(orgId, project.id, { startsOn: '01/12/2026' }, actor), 'validation');
  });

  it('exclui o projeto com tarefas e documentos, devolve as chaves e o grupo não vira projeto de novo', async () => {
    const { project } = await projects.createFromWeb(orgId, { title: 'Bazar' }, actor);
    const { group } = await projects.linkCreatedGroup(orgId, project.id, { instanceId, externalGroupId: `${randomUUID()}-group`, name: 'PROJETO - Bazar' }, actor);
    await db.projectTask.create({ data: { organizationId: orgId, projectId: project.id, title: 'Cartaz' } });
    await projects.addDocument(orgId, project.id, { kind: 'sketch', fileName: 'planta.pdf', contentType: 'application/pdf', sizeBytes: 10, storageKey: 'k/planta.pdf' }, actor);
    expect(await projects.isActivationBlocked(group.id)).toBe(false);

    expect(await projects.deleteProject(orgId, project.id, actor)).toEqual({ storageKeys: ['k/planta.pdf'] });
    await expectDomainError(projects.detail(orgId, project.id), 'not_found');
    expect(await db.projectTask.count({ where: { projectId: project.id } })).toBe(0);
    expect(await projects.isActivationBlocked(group.id)).toBe(true);
    expect(await db.auditEvent.count({ where: { organizationId: orgId, action: 'project.delete', entityId: project.id } })).toBe(1);
  });
});
