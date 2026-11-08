-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "contact_id" TEXT,
ADD COLUMN     "group_id" TEXT,
ADD COLUMN     "hourly_rate_cents" INTEGER;

-- CreateIndex
CREATE INDEX "bookings_group_id_idx" ON "bookings"("group_id");

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

