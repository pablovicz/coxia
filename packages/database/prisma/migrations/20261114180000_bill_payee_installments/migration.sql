-- AlterTable
ALTER TABLE "recurring_bills" ADD COLUMN     "installments" INTEGER,
ADD COLUMN     "payee_name" TEXT,
ADD COLUMN     "payment_details" TEXT;


-- Parcelas: entre 1 e 120.
ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_installments_check" CHECK ("installments" IS NULL OR ("installments" BETWEEN 1 AND 120));
