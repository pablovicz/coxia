-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "starts_on" DATE;

-- AlterTable
ALTER TABLE "whatsapp_groups" ADD COLUMN     "activation_blocked_at" TIMESTAMPTZ(6);
