-- CreateEnum
CREATE TYPE "ReminderType" AS ENUM ('general', 'call', 'message');

-- AlterTable
ALTER TABLE "reminders" ADD COLUMN     "contact_id" TEXT,
ADD COLUMN     "created_by_user_id" TEXT,
ADD COLUMN     "person_name" TEXT,
ADD COLUMN     "person_phone" TEXT,
ADD COLUMN     "type" "ReminderType" NOT NULL DEFAULT 'general';

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

