-- CreateEnum
CREATE TYPE "AppointmentKind" AS ENUM ('meeting', 'visit', 'event', 'other');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('scheduled', 'cancelled');

-- AlterEnum
ALTER TYPE "NotificationKind" ADD VALUE 'appointment_before';

-- CreateTable
CREATE TABLE "appointments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" "AppointmentKind" NOT NULL DEFAULT 'meeting',
    "title" TEXT NOT NULL,
    "location" TEXT,
    "notes" TEXT,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "all_team" BOOLEAN NOT NULL DEFAULT false,
    "notify_minutes_before" INTEGER DEFAULT 60,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'scheduled',
    "created_by_user_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointment_participants" (
    "id" TEXT NOT NULL,
    "appointment_id" TEXT NOT NULL,
    "member_id" TEXT,
    "contact_id" TEXT,
    "name" TEXT,
    "phone" TEXT,

    CONSTRAINT "appointment_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_organization_id_start_at_idx" ON "appointments"("organization_id", "start_at");

-- CreateIndex
CREATE INDEX "appointment_participants_appointment_id_idx" ON "appointment_participants"("appointment_id");

-- CreateIndex
CREATE INDEX "appointment_participants_member_id_idx" ON "appointment_participants"("member_id");

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_participants" ADD CONSTRAINT "appointment_participants_appointment_id_fkey" FOREIGN KEY ("appointment_id") REFERENCES "appointments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_participants" ADD CONSTRAINT "appointment_participants_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "organization_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointment_participants" ADD CONSTRAINT "appointment_participants_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Fim depois do início (garantido também pelo domínio).
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_time_check" CHECK ("end_at" > "start_at");
