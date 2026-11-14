-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('boleto', 'pix', 'credit_card');

-- AlterTable
ALTER TABLE "recurring_bills" ADD COLUMN     "payment_method" "PaymentMethod";

