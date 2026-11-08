/**
 * Seed da organização piloto (Casa Kaju). Idempotente: pode rodar várias vezes.
 * Horários de funcionamento e contas são PLACEHOLDERS — confirmar com a equipe.
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SPACES = [
  { slug: 'sala-grande', name: 'Sala Grande', aliases: ['sala grande', 'salão', 'grande'], sortOrder: 1, color: 'floresta', icon: 'palco' },
  { slug: 'sala-media', name: 'Sala Média', aliases: ['sala média', 'sala media', 'média', 'media'], sortOrder: 2, color: 'terracota', icon: 'musica' },
  { slug: 'sala-pequena', name: 'Sala Pequena', aliases: ['sala pequena', 'pequena'], sortOrder: 3, color: 'azul', icon: 'poltrona' },
];

const BILLS = [
  { name: 'Aluguel', category: 'aluguel', dueDay: 5, isVariableAmount: false },
  { name: 'Energia elétrica', category: 'energia', dueDay: 10, isVariableAmount: true },
  { name: 'Água', category: 'agua', dueDay: 15, isVariableAmount: true },
  { name: 'Internet', category: 'internet', dueDay: 20, isVariableAmount: false },
  { name: 'Telefone', category: 'telefone', dueDay: 20, isVariableAmount: false },
];

async function main() {
  const org = await prisma.organization.upsert({
    where: { slug: 'casa-kaju' },
    update: {},
    create: { name: 'Casa Kaju', slug: 'casa-kaju', timezone: 'America/Sao_Paulo' },
  });

  for (const s of SPACES) {
    const space = await prisma.space.upsert({
      where: { organizationId_slug: { organizationId: org.id, slug: s.slug } },
      // Salas existentes são da administração (tela Salas): o seed só cria as que faltam.
      update: {},
      create: { ...s, organizationId: org.id },
    });
    // Seg–sáb, 08:00–22:00 (placeholder). Só para sala sem horário: não desfaz o que a administração ajustou.
    if ((await prisma.spaceAvailabilityRule.count({ where: { spaceId: space.id } })) === 0) {
      await prisma.spaceAvailabilityRule.createMany({
        data: [1, 2, 3, 4, 5, 6].map((weekday) => ({ spaceId: space.id, weekday, opensAt: '08:00', closesAt: '22:00' })),
      });
    }
  }

  const existingBills = await prisma.recurringBill.findMany({ where: { organizationId: org.id } });
  for (const b of BILLS) {
    if (existingBills.some((e) => e.category === b.category)) continue;
    await prisma.recurringBill.create({
      data: { ...b, organizationId: org.id, startsOn: new Date('2026-11-01T00:00:00Z') },
    });
  }

  // Instância de WhatsApp: a real (ZAPI_INSTANCE_ID) ou a de desenvolvimento usada pelas fixtures.
  const provider = process.env.WHATSAPP_PROVIDER === 'zapi' ? 'zapi' : 'fake';
  const externalInstanceId = process.env.ZAPI_INSTANCE_ID || '3E1A2B3C4D5E6F708192A3B4C5D6E7F8';
  await prisma.whatsappInstance.upsert({
    where: { provider_externalInstanceId: { provider, externalInstanceId } },
    update: {},
    create: { organizationId: org.id, provider, externalInstanceId },
  });

  const email = process.env.SEED_ADMIN_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD;
  if (email && password) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        name: process.env.SEED_ADMIN_NAME ?? 'Administradora',
        phone: process.env.SEED_ADMIN_PHONE?.replace(/\D/g, '') || null,
        passwordHash: await bcrypt.hash(password, 12),
      },
    });
    await prisma.organizationMember.upsert({
      where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
      update: {},
      create: {
        organizationId: org.id,
        userId: user.id,
        role: 'owner',
        canManageProjects: true,
        receivesMorningBriefing: true,
      },
    });
    console.log(`admin: ${email}`);
  } else {
    console.log('SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD ausentes: nenhum admin criado.');
  }

  console.log(`organização ${org.name} (${org.id}) pronta`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
