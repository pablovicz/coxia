-- Etapa 3: evento task_done, check-in de projeto no grupo e comprovante único por organização.
-- AlterEnum
ALTER TYPE "ProjectEventType" ADD VALUE 'task_done';

-- AlterTable
ALTER TABLE "project_expenses" ADD COLUMN     "proof_sha256" TEXT;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "group_check_ins" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "project_expenses_organization_id_proof_sha256_key" ON "project_expenses"("organization_id", "proof_sha256");

