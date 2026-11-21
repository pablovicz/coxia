-- CreateEnum
CREATE TYPE "BookingSource" AS ENUM ('staff', 'resident');

-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('email_link', 'room_qr', 'staff');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('active', 'ended');

-- CreateEnum
CREATE TYPE "HourGrantKind" AS ENUM ('monthly', 'adjustment');

-- CreateEnum
CREATE TYPE "ResidentAccountStatus" AS ENUM ('invited', 'active', 'disabled');

-- CreateEnum
CREATE TYPE "ResidentTokenPurpose" AS ENUM ('invite', 'reset');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationKind" ADD VALUE 'resident_invite';
ALTER TYPE "NotificationKind" ADD VALUE 'password_reset';
ALTER TYPE "NotificationKind" ADD VALUE 'booking_invite';
ALTER TYPE "NotificationKind" ADD VALUE 'booking_cancelled';

-- AlterTable
ALTER TABLE "booking_occurrences" ADD COLUMN     "check_in_method" "CheckInMethod",
ADD COLUMN     "checked_in_at" TIMESTAMPTZ(6),
ADD COLUMN     "invite_sequence" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "contract_id" TEXT,
ADD COLUMN     "source" "BookingSource" NOT NULL DEFAULT 'staff';

-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "contract_id" TEXT;

-- AlterTable
ALTER TABLE "notification_deliveries" ADD COLUMN     "payload" JSONB;

-- CreateTable
CREATE TABLE "resident_contracts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "resident_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "monthly_minutes" INTEGER NOT NULL,
    "monthly_amount_cents" INTEGER,
    "payment_due_day" INTEGER,
    "cycle_day" INTEGER NOT NULL,
    "booking_opens_day" INTEGER NOT NULL,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "status" "ContractStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,
    "contract_key" TEXT,
    "contract_content_type" TEXT,
    "contract_file_name" TEXT,
    "contract_uploaded_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "resident_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hour_grants" (
    "id" TEXT NOT NULL,
    "contract_id" TEXT NOT NULL,
    "cycle" TEXT NOT NULL,
    "kind" "HourGrantKind" NOT NULL,
    "minutes" INTEGER NOT NULL,
    "note" TEXT,
    "monthly_key" TEXT,
    "actor_user_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hour_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resident_accounts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "resident_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "status" "ResidentAccountStatus" NOT NULL DEFAULT 'invited',
    "invited_at" TIMESTAMPTZ(6),
    "last_login_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "resident_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resident_auth_tokens" (
    "id" TEXT NOT NULL,
    "account_id" TEXT NOT NULL,
    "purpose" "ResidentTokenPurpose" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resident_auth_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "resident_contracts_organization_id_status_idx" ON "resident_contracts"("organization_id", "status");

-- CreateIndex
CREATE INDEX "resident_contracts_resident_id_idx" ON "resident_contracts"("resident_id");

-- CreateIndex
CREATE UNIQUE INDEX "hour_grants_monthly_key_key" ON "hour_grants"("monthly_key");

-- CreateIndex
CREATE INDEX "hour_grants_contract_id_cycle_idx" ON "hour_grants"("contract_id", "cycle");

-- CreateIndex
CREATE UNIQUE INDEX "resident_accounts_resident_id_key" ON "resident_accounts"("resident_id");

-- CreateIndex
CREATE UNIQUE INDEX "resident_accounts_email_key" ON "resident_accounts"("email");

-- CreateIndex
CREATE UNIQUE INDEX "resident_auth_tokens_token_hash_key" ON "resident_auth_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "resident_auth_tokens_account_id_idx" ON "resident_auth_tokens"("account_id");

-- CreateIndex
CREATE INDEX "bookings_contract_id_idx" ON "bookings"("contract_id");

-- CreateIndex
CREATE UNIQUE INDEX "incomes_contract_id_competence_key" ON "incomes"("contract_id", "competence");

-- AddForeignKey
ALTER TABLE "incomes" ADD CONSTRAINT "incomes_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "resident_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "resident_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_contracts" ADD CONSTRAINT "resident_contracts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_contracts" ADD CONSTRAINT "resident_contracts_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_contracts" ADD CONSTRAINT "resident_contracts_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hour_grants" ADD CONSTRAINT "hour_grants_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "resident_contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_accounts" ADD CONSTRAINT "resident_accounts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_accounts" ADD CONSTRAINT "resident_accounts_resident_id_fkey" FOREIGN KEY ("resident_id") REFERENCES "residents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resident_auth_tokens" ADD CONSTRAINT "resident_auth_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "resident_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Regras que o Prisma não expressa.
ALTER TABLE "resident_contracts"
  ADD CONSTRAINT "resident_contracts_days_check" CHECK (
    "cycle_day" BETWEEN 1 AND 31
    AND "booking_opens_day" BETWEEN 1 AND 31
    AND ("payment_due_day" IS NULL OR "payment_due_day" BETWEEN 1 AND 31)
  ),
  ADD CONSTRAINT "resident_contracts_minutes_check" CHECK ("monthly_minutes" > 0 AND "monthly_minutes" % 30 = 0),
  ADD CONSTRAINT "resident_contracts_amount_check" CHECK ("monthly_amount_cents" IS NULL OR "monthly_amount_cents" > 0),
  ADD CONSTRAINT "resident_contracts_period_check" CHECK ("ends_on" IS NULL OR "ends_on" >= "starts_on");

ALTER TABLE "hour_grants"
  ADD CONSTRAINT "hour_grants_cycle_check" CHECK ("cycle" ~ '^\d{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT "hour_grants_monthly_key_check" CHECK (("kind" = 'monthly') = ("monthly_key" IS NOT NULL)),
  ADD CONSTRAINT "hour_grants_minutes_check" CHECK ("minutes" % 30 = 0 AND ("kind" = 'adjustment' OR "minutes" > 0));

ALTER TABLE "resident_accounts"
  ADD CONSTRAINT "resident_accounts_email_lower_check" CHECK ("email" = lower("email"));

-- Check-in só em ocorrência ativa, sempre com o método.
ALTER TABLE "booking_occurrences"
  ADD CONSTRAINT "booking_occurrences_check_in_check" CHECK (("checked_in_at" IS NULL) = ("check_in_method" IS NULL));
