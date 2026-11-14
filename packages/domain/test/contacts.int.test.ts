/**
 * Contatos a partir dos grupos do WhatsApp: entrada, saída, mensagens, sincronização e busca.
 */
import { randomUUID } from 'node:crypto';
import { createPrismaClient } from '@coxia/database';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, ContactService, contactCardReply, DomainError } from '../src';

const db = createPrismaClient();
const actor: Actor = { channel: 'web', userId: null };
const contacts = new ContactService(db);
const OWN = '5511900000000'; // número da Coxia
const suffix = String(Date.now()).slice(-6);
const ph = (n: number) => `55119${suffix}${String(n).padStart(3, '0')}`;
const t = (min: number) => new Date(Date.UTC(2026, 10, 13, 12, min));

let orgId: string;
let xpo: string;
let lume: string;
const TEAM_PHONE = ph(900);

beforeAll(async () => {
  orgId = (await db.organization.create({ data: { name: 'Casa Contatos', slug: `contatos-${randomUUID()}` } })).id;
  const inst = await db.whatsappInstance.create({ data: { organizationId: orgId, provider: 'fake', externalInstanceId: randomUUID(), phone: OWN } });
  xpo = (await db.whatsappGroup.create({ data: { organizationId: orgId, instanceId: inst.id, externalGroupId: `${randomUUID()}-group`, name: 'PROJETO - XPO' } })).id;
  lume = (await db.whatsappGroup.create({ data: { organizationId: orgId, instanceId: inst.id, externalGroupId: `${randomUUID()}-group`, name: 'PROJETO - Lume' } })).id;
  const user = await db.user.create({ data: { name: 'Ana Admin', phone: TEAM_PHONE } });
  await db.organizationMember.create({ data: { organizationId: orgId, userId: user.id, role: 'admin' } });
});

afterAll(async () => {
  await db.organization.delete({ where: { id: orgId } }).catch(() => undefined);
  await db.user.deleteMany({ where: { phone: TEAM_PHONE } });
  await db.$disconnect();
});

describe('contatos dos grupos', () => {
  it('mensagem em grupo registra quem escreveu e a participação; o próprio número e IDs @lid ficam de fora', async () => {
    const c = await contacts.recordMessage(orgId, { phone: ph(1), whatsappName: 'João Silva', groupId: xpo, at: t(1), ownPhone: OWN });
    expect(c).toMatchObject({ phone: ph(1), whatsappName: 'João Silva', searchName: 'joao silva' });
    expect(await contacts.recordMessage(orgId, { phone: OWN, whatsappName: 'Coxia', groupId: xpo, at: t(1), ownPhone: OWN })).toBeNull();
    expect(await contacts.recordMessage(orgId, { phone: '81896604192873@lid', whatsappName: 'X', groupId: xpo, at: t(1) })).toBeNull();
    expect(await contacts.recordMessage(orgId, { phone: '123', whatsappName: 'curto', groupId: null, at: t(1) })).toBeNull();

    const membership = await db.contactGroup.findUniqueOrThrow({ where: { contactId_groupId: { contactId: c!.id, groupId: xpo } } });
    expect(membership).toMatchObject({ leftAt: null, joinedAt: t(1) });
  });

  it('nome do WhatsApp atualiza; "última mensagem" só avança (reprocessamento fora de ordem)', async () => {
    await contacts.recordMessage(orgId, { phone: ph(1), whatsappName: 'João S.', groupId: xpo, at: t(10), ownPhone: OWN });
    await contacts.recordMessage(orgId, { phone: ph(1), whatsappName: null, groupId: xpo, at: t(5), ownPhone: OWN });
    const c = await db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId: orgId, phone: ph(1) } } });
    expect(c.whatsappName).toBe('João S.');
    expect(c.lastMessageAt).toEqual(t(10));
  });

  it('adicionados entram, removidos saem com data, e quem volta reabre a participação', async () => {
    const added = await contacts.addToGroup(orgId, xpo, [{ phone: ph(2) }, { phone: ph(3), name: 'Bia' }, { phone: OWN }], t(20), OWN);
    expect(added).toEqual([ph(2), ph(3)]);
    expect(await contacts.removeFromGroup(orgId, xpo, [ph(2), 'lixo'], t(21))).toBe(1);

    const c2 = await db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId: orgId, phone: ph(2) } }, include: { groups: true } });
    expect(c2.groups[0]).toMatchObject({ groupId: xpo, leftAt: t(21) });

    await contacts.addToGroup(orgId, xpo, [{ phone: ph(2) }], t(30));
    const back = await db.contactGroup.findUniqueOrThrow({ where: { contactId_groupId: { contactId: c2.id, groupId: xpo } } });
    expect(back).toMatchObject({ leftAt: null, joinedAt: t(20) });
  });

  it('sincronização com o provedor: entra quem está, sai quem não está mais, marca a data', async () => {
    const res = await contacts.syncGroup(
      orgId,
      lume,
      [
        { phone: ph(1), isAdmin: true, name: null },
        { phone: ph(4), isAdmin: false, name: 'Carla Mendes' },
        { phone: TEAM_PHONE, isAdmin: true, name: 'Ana' },
        { phone: OWN, isAdmin: true, name: 'Coxia' },
      ],
      t(40),
      OWN,
    );
    expect(res).toEqual({ present: 3, left: 0 });

    const second = await contacts.syncGroup(orgId, lume, [{ phone: ph(1), isAdmin: true, name: null }, { phone: TEAM_PHONE, isAdmin: true, name: 'Ana' }], t(50), OWN);
    expect(second).toEqual({ present: 2, left: 1 });
    const carla = await db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId: orgId, phone: ph(4) } }, include: { groups: true } });
    expect(carla.groups[0]).toMatchObject({ groupId: lume, leftAt: t(50) });
    expect((await db.whatsappGroup.findUniqueOrThrow({ where: { id: lume } })).contactsSyncedAt).toEqual(t(50));
    // Sair de um grupo não mexe no outro.
    const joao = await db.contactGroup.findUniqueOrThrow({ where: { contactId_groupId: { contactId: (await db.contact.findFirstOrThrow({ where: { organizationId: orgId, phone: ph(1) } })).id, groupId: xpo } } });
    expect(joao.leftAt).toBeNull();
  });

  it('a mesma pessoa escrevendo várias vezes ao mesmo tempo vira um contato só', async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => contacts.recordMessage(orgId, { phone: ph(5), whatsappName: 'Duda', groupId: xpo, at: t(60 + i), ownPhone: OWN })),
    );
    expect(await db.contact.count({ where: { organizationId: orgId, phone: ph(5) } })).toBe(1);
  });
});

describe('busca de contatos', () => {
  it('por nome sem acento, por trecho do telefone e por grupo; marca quem é da equipe', async () => {
    const byName = await contacts.list(orgId, { q: 'joao' });
    expect(byName.items.map((c) => c.phone)).toEqual([ph(1)]);
    expect(byName.items[0]!.groups.map((g) => g.group.name).sort()).toEqual(['PROJETO - Lume', 'PROJETO - XPO']);

    const byPhone = await contacts.list(orgId, { q: ph(3).slice(-5) });
    expect(byPhone.items.map((c) => c.phone)).toEqual([ph(3)]);

    // No grupo Lume agora: João e Ana (equipe). Carla saiu.
    const inLume = await contacts.list(orgId, { groupId: lume });
    expect(inLume.items.map((c) => c.phone).sort()).toEqual([ph(1), TEAM_PHONE].sort());
    expect(inLume.items.find((c) => c.phone === TEAM_PHONE)!.member).toEqual({ name: 'Ana Admin', role: 'admin' });

    expect((await contacts.list(orgId, { q: '%%' })).items).toEqual([]);
    const all = await contacts.list(orgId);
    expect(all.total).toBe(6);
    // Quem escreveu por último aparece primeiro.
    expect(all.items[0]!.phone).toBe(ph(5));
  });

  it('nome dado pela equipe entra na busca; observações ficam salvas e auditadas', async () => {
    const carla = await db.contact.findFirstOrThrow({ where: { organizationId: orgId, phone: ph(4) } });
    const updated = await contacts.update(orgId, carla.id, { name: 'Carla (iluminação)', notes: 'Freela de luz' }, actor);
    expect(updated).toMatchObject({ name: 'Carla (iluminação)', notes: 'Freela de luz', whatsappName: 'Carla Mendes' });
    expect((await contacts.list(orgId, { q: 'iluminacao' })).items.map((c) => c.id)).toEqual([carla.id]);
    expect(await db.auditEvent.count({ where: { organizationId: orgId, action: 'contact.update', entityId: carla.id } })).toBe(1);

    const detail = await contacts.get(orgId, carla.id);
    expect(detail.groups.map((g) => [g.group.name, g.leftAt !== null])).toEqual([['PROJETO - Lume', true]]);
    await expect(contacts.get(randomUUID(), carla.id)).rejects.toBeInstanceOf(DomainError);
  });

  it('grupos para o filtro com quantas pessoas estão em cada um', async () => {
    const groups = await contacts.listGroups(orgId);
    expect(groups).toEqual([
      { id: lume, name: 'PROJETO - Lume', members: 2 },
      { id: xpo, name: 'PROJETO - XPO', members: 4 },
    ]);
  });
});

describe('cartão de contato enviado pela equipe', () => {
  const whatsapp: Actor = { channel: 'whatsapp', userId: null, phone: TEAM_PHONE };

  it('cada telefone vira contato com o nome do cartão; não sobrescreve nome dado pela equipe; ignora o próprio número', async () => {
    const saved = await contacts.saveFromCards(
      orgId,
      [
        { name: 'Marina Patrocínio', phones: [ph(201), OWN] },
        { name: 'Seu Zé do som', phones: [ph(202), ph(203)] },
        { name: 'Ilegível', phones: ['123'] },
      ],
      whatsapp,
      OWN,
    );
    expect(saved.map((s) => [s.phone, s.name, s.created])).toEqual([
      [ph(201), 'Marina Patrocínio', true],
      [ph(202), 'Seu Zé do som', true],
      [ph(203), 'Seu Zé do som', true],
    ]);
    const marina = await db.contact.findUniqueOrThrow({ where: { organizationId_phone: { organizationId: orgId, phone: ph(201) } } });
    expect(marina).toMatchObject({ name: 'Marina Patrocínio', searchName: 'marina patrocinio' });
    expect(await db.auditEvent.count({ where: { organizationId: orgId, action: 'contact.create_from_card' } })).toBe(3);

    // A equipe renomeou: um novo cartão com outro nome não muda o nome dado.
    await contacts.update(orgId, marina.id, { name: 'Marina (patrocínio)' }, actor);
    const again = await contacts.saveFromCards(orgId, [{ name: 'Marina P.', phones: [ph(201)] }], whatsapp, OWN);
    expect(again).toEqual([{ contactId: marina.id, phone: ph(201), name: 'Marina (patrocínio)', created: false }]);

    // Já existia sem nome (só pelo WhatsApp): o cartão dá o nome.
    await contacts.recordMessage(orgId, { phone: ph(204), whatsappName: 'jr', groupId: null, at: t(30), ownPhone: OWN });
    const named = await contacts.saveFromCards(orgId, [{ name: 'Júnior da luz', phones: [ph(204)] }], whatsapp, OWN);
    expect(named[0]).toMatchObject({ name: 'Júnior da luz', created: false });
  });

  it('resposta da Coxia: salvo, já existente, vários e ilegível', () => {
    expect(contactCardReply([{ phone: '5511988880000', name: 'Marina', created: true }])).toBe('📇 Contato salvo: Marina · +55 11 98888-0000');
    expect(contactCardReply([{ phone: '5511988880000', name: 'Marina', created: false }])).toBe('📇 Marina · +55 11 98888-0000 já estava nos contatos.');
    expect(
      contactCardReply([
        { phone: '5511988880000', name: 'Marina', created: true },
        { phone: '551133334444', name: 'Seu Zé', created: true },
        { phone: '5511987650002', name: 'Carla', created: false },
      ]),
    ).toBe('📇 2 contatos salvos:\n• Marina · +55 11 98888-0000\n• Seu Zé · +55 11 3333-4444\nCarla · +55 11 98765-0002 já estava nos contatos.');
    expect(contactCardReply([])).toContain('Não consegui ler o telefone');
  });
});
