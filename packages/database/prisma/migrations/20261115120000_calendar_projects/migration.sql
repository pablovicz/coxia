-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "project_id" TEXT;

-- AlterTable
ALTER TABLE "appointments" ADD COLUMN     "project_id" TEXT;

-- CreateIndex
CREATE INDEX "reminders_project_id_idx" ON "reminders"("project_id");

-- CreateIndex
CREATE INDEX "appointments_project_id_idx" ON "appointments"("project_id");

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

