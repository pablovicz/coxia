-- AlterTable
ALTER TABLE "whatsapp_groups" ADD COLUMN     "contacts_synced_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "name" TEXT,
    "whatsapp_name" TEXT,
    "notes" TEXT,
    "search_name" TEXT NOT NULL DEFAULT '',
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_groups" (
    "contact_id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "is_admin" BOOLEAN NOT NULL DEFAULT false,
    "joined_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "left_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "contact_groups_pkey" PRIMARY KEY ("contact_id","group_id")
);

-- CreateIndex
CREATE INDEX "contacts_organization_id_last_message_at_idx" ON "contacts"("organization_id", "last_message_at");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_organization_id_phone_key" ON "contacts"("organization_id", "phone");

-- CreateIndex
CREATE INDEX "contact_groups_group_id_idx" ON "contact_groups"("group_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_groups" ADD CONSTRAINT "contact_groups_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_groups" ADD CONSTRAINT "contact_groups_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "whatsapp_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Contatos a partir das mensagens já recebidas (quem escreveu em grupo ou em conversa direta).
-- Ignora o próprio número da instância, mensagens enviadas por ele e telefones inválidos (só dígitos, 10–15).
INSERT INTO "contacts" ("id", "organization_id", "phone", "whatsapp_name", "last_message_at", "updated_at")
SELECT 'c' || md5(m.organization_id || ':' || m.sender_phone), m.organization_id, m.sender_phone,
       (array_agg(m.sender_name ORDER BY m.sent_at DESC) FILTER (WHERE m.sender_name IS NOT NULL))[1],
       max(m.sent_at), CURRENT_TIMESTAMP
FROM "messages" m
WHERE m.from_me = false
  AND m.sender_phone ~ '^[0-9]{10,15}$'
  AND NOT EXISTS (
    SELECT 1 FROM "whatsapp_instances" i WHERE i.organization_id = m.organization_id AND i.phone = m.sender_phone
  )
GROUP BY m.organization_id, m.sender_phone
ON CONFLICT ("organization_id", "phone") DO NOTHING;

INSERT INTO "contact_groups" ("contact_id", "group_id", "joined_at", "updated_at")
SELECT c.id, cv.group_id, min(m.sent_at), CURRENT_TIMESTAMP
FROM "messages" m
JOIN "conversations" cv ON cv.id = m.conversation_id AND cv.group_id IS NOT NULL
JOIN "contacts" c ON c.organization_id = m.organization_id AND c.phone = m.sender_phone
WHERE m.from_me = false
GROUP BY c.id, cv.group_id
ON CONFLICT ("contact_id", "group_id") DO NOTHING;

-- Busca sem acento para os contatos criados acima.
UPDATE "contacts"
SET "search_name" = translate(lower(coalesce("whatsapp_name", '')), 'áàâãäéèêëíìîïóòôõöúùûüç', 'aaaaaeeeeiiiiooooouuuuc');
