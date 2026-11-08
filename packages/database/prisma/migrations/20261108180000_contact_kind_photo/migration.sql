-- CreateEnum
CREATE TYPE "ContactKind" AS ENUM ('contact', 'resident');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "kind" "ContactKind" NOT NULL DEFAULT 'contact',
ADD COLUMN     "photo_url" TEXT,
ADD COLUMN     "profile_fetched_at" TIMESTAMPTZ(6);


-- Quem já tem reserva recorrente é residente.
UPDATE "contacts" c SET "kind" = 'resident'
WHERE EXISTS (SELECT 1 FROM "bookings" b WHERE b.contact_id = c.id AND b.recurrence_rule IS NOT NULL AND b.status <> 'cancelled');
