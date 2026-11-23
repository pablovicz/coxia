/**
 * Módulo de Tarefas: criar com responsáveis (residentes) e projeto opcional, encerrar com data e
 * quem realizou, reabrir, observações e filtros (com as contagens das abas).
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, DomainError, TaskService } from '../src';

const db = createPrismaClient();
const tasks = new TaskService(db);
const suffix = String(Date.now()).slice(-7);
let orgId: string;
let otherOrgId: string;
let projectId: string;
let residentId: string;
let anaMember: string;
let brunoMember: string;
let ana: Actor;
let bruno: Actor;

async function expectDomainError(p: Promise<unknown>, code: string) {
  const err = await p.catch((e: unknown) => e);
  expect(err).toBeInstanceOf(DomainError);
  expect((err as DomainError).code).toBe(code);
}

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Tarefas', slug: `tk-${randomUUID()}` } })).id;
  otherOrgId = (await db.organization.create({ data: { name: 'Outra casa', slug: `tk-${randomUUID()}` } })).id;
  const mk = async (name: string, role: 'owner' | 'staff') => {
    const u = await db.user.create({ data: { name: `${name} ${suffix}` } });
    const m = await db.organizationMember.create({ data: { organizationId: orgId, userId: u.id, role } });
    return { userId: u.id, memberId: m.id };
  };
  const a = await mk('Ana', 'owner');
  const b = await mk('Bruno', 'staff');
  anaMember = a.memberId;
  brunoMember = b.memberId;
  ana = { channel: 'web', userId: a.userId };
  bruno = { channel: 'web', userId: b.userId };
  projectId = (await db.project.create({ data: { organizationId: orgId, title: 'Natal', status: 'active' } })).id;
  const contact = await db.contact.create({ data: { organizationId: orgId, phone: `5541${suffix}01`, name: 'Nat' } });
  residentId = (await db.resident.create({ data: { organizationId: orgId, contactId: contact.id, name: 'Nat' } })).id;
});

afterAll(async () => {
  await db.organization.deleteMany({ where: { id: { in: [orgId, otherOrgId] } } });
  await db.user.deleteMany({ where: { name: { endsWith: suffix } } });
  await db.$disconnect();
});

describe('tarefas', () => {
  it('cria com projeto e responsáveis; título vazio, residente ou projeto de outra casa recusados', async () => {
    const t = await tasks.create(orgId, { title: '  Fazer   bolinhas ', complexity: 'high', projectId, residentIds: [residentId] }, ana);
    expect(t).toMatchObject({ title: 'Fazer bolinhas', complexity: 'high', status: 'pending', project: { id: projectId, title: 'Natal' }, notesCount: 0 });
    expect(t.assignees.map((a) => a.id)).toEqual([residentId]);
    await expectDomainError(tasks.create(orgId, { title: '  ', complexity: 'low' }, ana), 'validation');
    await expectDomainError(tasks.create(otherOrgId, { title: 'X', complexity: 'low', residentIds: [residentId] }, ana), 'not_found');
    await expectDomainError(tasks.create(otherOrgId, { title: 'X', complexity: 'low', projectId }, ana), 'not_found');
  });

  it('conclui com data e quem realizou; editar não desfaz; reabrir limpa', async () => {
    const t = await tasks.create(orgId, { title: 'Comprar EPIs', complexity: 'medium', status: 'in_progress' }, ana);
    expect(t.status).toBe('in_progress');
    const done = await tasks.complete(orgId, t.id, { completedOn: '2026-11-18', memberIds: [anaMember, brunoMember] }, ana);
    expect(done).toMatchObject({ status: 'done', completedOn: '2026-11-18' });
    expect(done.completers.map((c) => c.memberId).sort()).toEqual([anaMember, brunoMember].sort());
    const edited = await tasks.update(orgId, t.id, { title: 'Comprar EPIs e luvas', complexity: 'low', status: 'pending' }, ana);
    expect(edited).toMatchObject({ status: 'done', title: 'Comprar EPIs e luvas', completedOn: '2026-11-18' });
    const reopened = await tasks.reopen(orgId, t.id, ana);
    expect(reopened).toMatchObject({ status: 'pending', completedOn: null, completers: [] });
    await expectDomainError(tasks.reopen(orgId, t.id, ana), 'validation');
    const today = await tasks.complete(orgId, t.id, { memberIds: [anaMember] }, ana);
    expect(today.completedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('observações: autor é quem escreveu; só ele ou a administração apaga', async () => {
    const t = await tasks.create(orgId, { title: 'Montar a árvore', complexity: 'high' }, ana);
    const withNote = await tasks.addNote(orgId, t.id, ' Andaime chega dia 02 ', bruno);
    expect(withNote.notes).toHaveLength(1);
    expect(withNote.notes[0]).toMatchObject({ body: 'Andaime chega dia 02', author: { memberId: brunoMember } });
    const noteId = withNote.notes[0]!.id;
    const other = await tasks.addNote(orgId, t.id, 'Ok', ana);
    await expectDomainError(tasks.removeNote(orgId, t.id, other.notes[1]!.id, bruno, false), 'forbidden');
    expect((await tasks.removeNote(orgId, t.id, noteId, bruno, false)).notes).toHaveLength(1);
    expect((await tasks.removeNote(orgId, t.id, other.notes[1]!.id, bruno, true)).notes).toHaveLength(0);
    await expectDomainError(tasks.addNote(orgId, t.id, '   ', ana), 'validation');
  });

  it('filtros e contagens das abas', async () => {
    const all = await tasks.list(orgId);
    expect(all.counts.pending + all.counts.in_progress + all.counts.done).toBe(all.tasks.length);
    const byProject = await tasks.list(orgId, { projectId });
    expect(byProject.tasks.map((t) => t.title)).toEqual(['Fazer bolinhas']);
    const none = await tasks.list(orgId, { projectId: 'none' });
    expect(none.tasks.every((t) => t.project === null)).toBe(true);
    expect((await tasks.list(orgId, { residentId })).tasks).toHaveLength(1);
    expect((await tasks.list(orgId, { complexity: 'high' })).tasks.map((t) => t.title).sort()).toEqual(['Fazer bolinhas', 'Montar a árvore']);
    expect((await tasks.list(orgId, { completedBy: anaMember })).tasks.map((t) => t.title)).toEqual(['Comprar EPIs e luvas']);
    expect((await tasks.list(orgId, { q: 'árvore' })).tasks).toHaveLength(1);
    const pending = await tasks.list(orgId, { status: 'pending' });
    expect(pending.tasks.every((t) => t.status === 'pending')).toBe(true);
    expect(pending.counts).toEqual(all.counts);
    expect((await tasks.list(orgId, { from: '2020-01-01', to: '2020-01-31' })).tasks).toHaveLength(0);
    expect((await tasks.list(otherOrgId)).tasks).toHaveLength(0);
  });

  it('apagar leva as observações junto', async () => {
    const t = await tasks.create(orgId, { title: 'Desmontar', complexity: 'low' }, ana);
    await tasks.addNote(orgId, t.id, 'Em janeiro', ana);
    await tasks.remove(orgId, t.id, ana);
    await expectDomainError(tasks.get(orgId, t.id), 'not_found');
    expect(await db.taskNote.count({ where: { taskId: t.id } })).toBe(0);
  });
});
