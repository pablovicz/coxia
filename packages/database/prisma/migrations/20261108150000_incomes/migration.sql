-- CreateEnum
CREATE TYPE "IncomeSource" AS ENUM ('project', 'room_rental', 'other');

-- CreateEnum
CREATE TYPE "IncomeStatus" AS ENUM ('expected', 'received', 'cancelled');

-- AlterTable
ALTER TABLE "spaces" ADD COLUMN     "rent_amount_cents" INTEGER,
ADD COLUMN     "rent_due_day" INTEGER,
ADD COLUMN     "tenant_name" TEXT;

-- CreateTable
CREATE TABLE "incomes" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "source" "IncomeSource" NOT NULL,
    "description" TEXT NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "expected_on" DATE NOT NULL,
    "status" "IncomeStatus" NOT NULL DEFAULT 'expected',
    "received_on" DATE,
    "received_amount_cents" INTEGER,
    "payer_name" TEXT,
    "notes" TEXT,
    "project_id" TEXT,
    "space_id" TEXT,
    "competence" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "incomes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "incomes_organization_id_expected_on_idx" ON "incomes"("organization_id", "expected_on");

-- CreateIndex
CREATE INDEX "incomes_project_id_idx" ON "incomes"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "incomes_space_id_competence_key" ON "incomes"("space_id", "competence");

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

