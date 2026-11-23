-- Responsáveis das tarefas passam a ser pessoas da equipe (antes, residentes).
-- Vínculos com residentes não têm equivalente na equipe: saem (as tarefas ficam).
DELETE FROM "task_assignees";

-- DropForeignKey
ALTER TABLE "task_assignees" DROP CONSTRAINT "task_assignees_resident_id_fkey";

-- DropIndex
DROP INDEX "task_assignees_resident_id_idx";

-- AlterTable
ALTER TABLE "task_assignees" DROP CONSTRAINT "task_assignees_pkey",
DROP COLUMN "resident_id",
ADD COLUMN     "member_id" TEXT NOT NULL,
ADD CONSTRAINT "task_assignees_pkey" PRIMARY KEY ("task_id", "member_id");

-- CreateIndex
CREATE INDEX "task_assignees_member_id_idx" ON "task_assignees"("member_id");

-- AddForeignKey
ALTER TABLE "task_assignees" ADD CONSTRAINT "task_assignees_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

