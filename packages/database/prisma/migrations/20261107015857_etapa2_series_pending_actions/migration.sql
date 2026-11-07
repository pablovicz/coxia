-- CreateEnum
CREATE TYPE "PendingActionStatus" AS ENUM ('pending', 'confirmed', 'cancelled', 'expired');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "local_end_time" TEXT,
ADD COLUMN     "local_start_time" TEXT,
ADD COLUMN     "materialized_until" DATE,
ADD COLUMN     "series_starts_on" DATE;

-- CreateTable
CREATE TABLE "pending_actions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "requested_by_phone" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "summary" TEXT NOT NULL,
    "status" "PendingActionStatus" NOT NULL DEFAULT 'pending',
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "source_message_id" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pending_actions_conversation_id_status_idx" ON "pending_actions"("conversation_id", "status");

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_actions" ADD CONSTRAINT "pending_actions_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Horários locais de série no formato HH:mm, início antes do fim (séries não cruzam a meia-noite).
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_local_times"
  CHECK (
    ("local_start_time" IS NULL AND "local_end_time" IS NULL)
    OR ("local_start_time" ~ '^([01]\d|2[0-3]):[0-5]\d$' AND "local_end_time" ~ '^([01]\d|2[0-3]):[0-5]\d$'
        AND "local_start_time" < "local_end_time")
  );
