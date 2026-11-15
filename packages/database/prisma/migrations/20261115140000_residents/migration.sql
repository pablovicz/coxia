-- CreateEnum
CREATE TYPE "ResidentStatus" AS ENUM ('active', 'disabled');

-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "contact_id" TEXT;

-- CreateTable
CREATE TABLE "residents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "contact_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instagram" TEXT,
    "email" TEXT,
    "status" "ResidentStatus" NOT NULL DEFAULT 'active',
    "payment_day" INTEGER,
    "photo_key" TEXT,
    "photo_content_type" TEXT,
    "photo_updated_at" TIMESTAMPTZ(6),
    "contract_key" TEXT,
    "contract_content_type" TEXT,
    "contract_file_name" TEXT,
    "contract_uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "residents_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "residents_payment_day_check" CHECK ("payment_day" IS NULL OR ("payment_day" BETWEEN 1 AND 31))
);

-- CreateIndex
CREATE UNIQUE INDEX "residents_contact_id_key" ON "residents"("contact_id");

-- CreateIndex
CREATE INDEX "residents_organization_id_idx" ON "residents"("organization_id");

-- CreateIndex
CREATE INDEX "incomes_contact_id_idx" ON "incomes"("contact_id");

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residents" ADD CONSTRAINT "residents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "residents" ADD CONSTRAINT "residents_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Quem já é residente (contato com reserva recorrente) ganha o cadastro de residente.
INSERT INTO "residents" ("id", "organization_id", "contact_id", "name", "created_at", "updated_at")
SELECT 'rs' || md5(c."id"), c."organization_id", c."id", COALESCE(c."name", c."whatsapp_name", c."phone"), CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "contacts" c
WHERE c."kind" = 'resident'
ON CONFLICT ("contact_id") DO NOTHING;
