-- AlterTable
ALTER TABLE "resident_accounts" ADD COLUMN     "must_change_password" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sessions_valid_from" TIMESTAMPTZ(6);

