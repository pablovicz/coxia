-- AlterTable
ALTER TABLE "incomes" ADD COLUMN     "proof_content_type" TEXT,
ADD COLUMN     "proof_file_name" TEXT,
ADD COLUMN     "proof_key" TEXT,
ADD COLUMN     "proof_uploaded_at" TIMESTAMPTZ(6);

