-- AlterTable
ALTER TABLE "spaces" ADD COLUMN     "show_on_site" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "quote_requests" ADD COLUMN     "space_id" TEXT;

-- AddForeignKey
ALTER TABLE "quote_requests" ADD CONSTRAINT "quote_requests_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

