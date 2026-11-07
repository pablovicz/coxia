-- Etapa 4: comprovante de conta único por organização (antes: por ocorrência) e marca de retenção nas mensagens.
-- DropIndex
DROP INDEX "public"."payment_attachments_bill_occurrence_id_sha256_key";

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "redacted_at" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "payment_attachments_organization_id_sha256_key" ON "payment_attachments"("organization_id", "sha256");

