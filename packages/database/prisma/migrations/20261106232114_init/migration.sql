-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('owner', 'admin', 'staff', 'viewer');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('draft', 'active', 'closing', 'closed');

-- CreateEnum
CREATE TYPE "BookingStatus" AS ENUM ('tentative', 'confirmed', 'cancelled');

-- CreateEnum
CREATE TYPE "BillOccurrenceStatus" AS ENUM ('pending', 'partially_paid', 'paid', 'overdue', 'cancelled');

-- CreateEnum
CREATE TYPE "ProjectExpenseStatus" AS ENUM ('proposed', 'confirmed', 'paid', 'rejected');

-- CreateEnum
CREATE TYPE "ProjectExpenseKind" AS ENUM ('quote', 'expense');

-- CreateEnum
CREATE TYPE "ProjectTaskStatus" AS ENUM ('proposed', 'open', 'done', 'cancelled');

-- CreateEnum
CREATE TYPE "ProjectEventType" AS ENUM ('briefing', 'task', 'decision', 'quote', 'expense', 'payment_proof', 'question', 'close_request');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('pending_review', 'auto_applied', 'confirmed', 'rejected');

-- CreateEnum
CREATE TYPE "Commitment" AS ENUM ('committed', 'suggested', 'unclear');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('inbound', 'outbound');

-- CreateEnum
CREATE TYPE "MessageProcessingStatus" AS ENUM ('received', 'queued', 'processing', 'processed', 'ignored', 'failed');

-- CreateEnum
CREATE TYPE "ReminderKind" AS ENUM ('one_time', 'recurring');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('morning_briefing', 'booking_day_before', 'booking_one_hour_before', 'bill_day_before', 'bill_due_today', 'bill_overdue', 'project_checkin', 'project_confirmation', 'ad_hoc');

-- CreateEnum
CREATE TYPE "NotificationScheduleStatus" AS ENUM ('scheduled', 'enqueued', 'done', 'skipped', 'cancelled');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('pending', 'sending', 'sent', 'failed', 'dead');

-- CreateEnum
CREATE TYPE "AiExecutionStatus" AS ENUM ('succeeded', 'failed');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
    "project_group_prefix" TEXT NOT NULL DEFAULT 'PROJETO',
    "morning_briefing_time" TEXT NOT NULL DEFAULT '08:00',
    "retention_days" INTEGER NOT NULL DEFAULT 730,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "password_hash" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_members" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'staff',
    "can_manage_projects" BOOLEAN NOT NULL DEFAULT false,
    "receives_morning_briefing" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_instances" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'zapi',
    "external_instance_id" TEXT NOT NULL,
    "phone" TEXT,
    "connected" BOOLEAN NOT NULL DEFAULT false,
    "last_checked_at" TIMESTAMPTZ(6),
    "last_connected_at" TIMESTAMPTZ(6),
    "last_error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whatsapp_groups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "external_group_id" TEXT NOT NULL,
    "name" TEXT,
    "last_seen_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "instance_id" TEXT NOT NULL,
    "external_chat_id" TEXT NOT NULL,
    "is_group" BOOLEAN NOT NULL,
    "group_id" TEXT,
    "last_message_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "direction" "MessageDirection" NOT NULL,
    "provider" TEXT NOT NULL,
    "external_message_id" TEXT,
    "dedupe_key" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sender_phone" TEXT,
    "sender_name" TEXT,
    "from_me" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT,
    "sent_at" TIMESTAMPTZ(6) NOT NULL,
    "received_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "raw_payload" JSONB,
    "normalized" JSONB,
    "processing_status" "MessageProcessingStatus" NOT NULL DEFAULT 'received',
    "processing_error" TEXT,
    "processed_at" TIMESTAMPTZ(6),
    "trace_id" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_attachments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "mime_type" TEXT,
    "file_name" TEXT,
    "source_url" TEXT NOT NULL,
    "storage_key" TEXT,
    "size_bytes" INTEGER,
    "sha256" TEXT,
    "duration_seconds" DOUBLE PRECISION,
    "transcript" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "ProjectStatus" NOT NULL DEFAULT 'draft',
    "objective" TEXT,
    "briefing" JSONB,
    "estimated_budget_cents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "created_by_phone" TEXT,
    "activated_at" TIMESTAMPTZ(6),
    "closing_requested_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "closed_by_phone" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_channels" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "whatsapp_group_id" TEXT NOT NULL,
    "display_name" TEXT,
    "linked_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "type" "ProjectEventType" NOT NULL,
    "source_message_id" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION,
    "commitment" "Commitment" NOT NULL DEFAULT 'unclear',
    "review_status" "ReviewStatus" NOT NULL DEFAULT 'pending_review',
    "author_phone" TEXT,
    "ai_execution_id" TEXT,
    "model" TEXT,
    "prompt_version" TEXT,
    "parser_version" TEXT,
    "reviewed_by_phone" TEXT,
    "reviewed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_tasks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "assignee_name" TEXT,
    "assignee_phone" TEXT,
    "due_date" DATE,
    "status" "ProjectTaskStatus" NOT NULL DEFAULT 'proposed',
    "source_event_id" TEXT,
    "source_message_id" TEXT,
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_decisions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "source_event_id" TEXT,
    "source_message_id" TEXT,
    "decided_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_expenses" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" "ProjectExpenseKind" NOT NULL,
    "description" TEXT NOT NULL,
    "vendor" TEXT,
    "amount_cents" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "status" "ProjectExpenseStatus" NOT NULL DEFAULT 'proposed',
    "source_event_id" TEXT,
    "source_message_id" TEXT,
    "proof_attachment_id" TEXT,
    "confirmed_by_phone" TEXT,
    "confirmed_at" TIMESTAMPTZ(6),
    "paid_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "project_expenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_summaries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "project_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "state_snapshot" JSONB NOT NULL,
    "ai_execution_id" TEXT,
    "generated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spaces" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "capacity" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "spaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_availability_rules" (
    "id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "opens_at" TEXT NOT NULL,
    "closes_at" TEXT NOT NULL,

    CONSTRAINT "space_availability_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "space_blocks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "space_blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "title" TEXT,
    "responsible_name" TEXT,
    "responsible_phone" TEXT,
    "notes" TEXT,
    "status" "BookingStatus" NOT NULL DEFAULT 'confirmed',
    "recurrence_rule" TEXT,
    "series_until" DATE,
    "notify_one_hour_before" BOOLEAN NOT NULL DEFAULT false,
    "created_by_phone" TEXT,
    "source_message_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "booking_occurrences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "booking_id" TEXT NOT NULL,
    "space_id" TEXT NOT NULL,
    "start_at" TIMESTAMPTZ(6) NOT NULL,
    "end_at" TIMESTAMPTZ(6) NOT NULL,
    "status" "BookingStatus" NOT NULL DEFAULT 'confirmed',
    "is_exception" BOOLEAN NOT NULL DEFAULT false,
    "cancelled_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "booking_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reminders" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" "ReminderKind" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT,
    "due_at" TIMESTAMPTZ(6),
    "recurrence_rule" TEXT,
    "next_run_at" TIMESTAMPTZ(6),
    "recipient_phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "reminders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recurring_bills" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "responsible_name" TEXT,
    "responsible_phone" TEXT,
    "due_day" INTEGER NOT NULL,
    "estimated_amount_cents" INTEGER,
    "is_variable_amount" BOOLEAN NOT NULL DEFAULT false,
    "currency" TEXT NOT NULL DEFAULT 'BRL',
    "recipient_phones" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "overdue_reminder_every_days" INTEGER NOT NULL DEFAULT 3,
    "starts_on" DATE NOT NULL,
    "ends_on" DATE,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "suspended_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "recurring_bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bill_occurrences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "recurring_bill_id" TEXT NOT NULL,
    "competence" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "expected_amount_cents" INTEGER,
    "paid_amount_cents" INTEGER NOT NULL DEFAULT 0,
    "status" "BillOccurrenceStatus" NOT NULL DEFAULT 'pending',
    "paid_at" TIMESTAMPTZ(6),
    "confirmed_by_phone" TEXT,
    "source_message_id" TEXT,
    "notes" TEXT,
    "last_overdue_notice_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "bill_occurrences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_attachments" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "bill_occurrence_id" TEXT NOT NULL,
    "message_attachment_id" TEXT,
    "storage_key" TEXT,
    "sha256" TEXT,
    "amount_cents" INTEGER,
    "paid_on" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_schedules" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "status" "NotificationScheduleStatus" NOT NULL DEFAULT 'scheduled',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "schedule_id" TEXT,
    "channel" TEXT NOT NULL DEFAULT 'whatsapp',
    "recipient" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "available_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "provider_message_id" TEXT,
    "sent_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6),

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_executions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "status" "AiExecutionStatus" NOT NULL,
    "model" TEXT,
    "prompt_version" TEXT,
    "parser_version" TEXT,
    "input_tokens" INTEGER NOT NULL DEFAULT 0,
    "output_tokens" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "request_hash" TEXT NOT NULL,
    "source_message_id" TEXT,
    "error" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_executions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "actor_phone" TEXT,
    "actor_channel" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "source_message_id" TEXT,
    "trace_id" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_instances_provider_external_instance_id_key" ON "whatsapp_instances"("provider", "external_instance_id");

-- CreateIndex
CREATE UNIQUE INDEX "whatsapp_groups_instance_id_external_group_id_key" ON "whatsapp_groups"("instance_id", "external_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_group_id_key" ON "conversations"("group_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_instance_id_external_chat_id_key" ON "conversations"("instance_id", "external_chat_id");

-- CreateIndex
CREATE UNIQUE INDEX "messages_dedupe_key_key" ON "messages"("dedupe_key");

-- CreateIndex
CREATE INDEX "messages_conversation_id_sent_at_idx" ON "messages"("conversation_id", "sent_at");

-- CreateIndex
CREATE INDEX "messages_processing_status_idx" ON "messages"("processing_status");

-- CreateIndex
CREATE INDEX "message_attachments_organization_id_sha256_idx" ON "message_attachments"("organization_id", "sha256");

-- CreateIndex
CREATE INDEX "projects_organization_id_status_idx" ON "projects"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_channels_whatsapp_group_id_key" ON "project_channels"("whatsapp_group_id");

-- CreateIndex
CREATE INDEX "project_events_project_id_created_at_idx" ON "project_events"("project_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "project_events_source_message_id_type_fingerprint_key" ON "project_events"("source_message_id", "type", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "project_tasks_source_event_id_key" ON "project_tasks"("source_event_id");

-- CreateIndex
CREATE INDEX "project_tasks_project_id_status_idx" ON "project_tasks"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "project_decisions_source_event_id_key" ON "project_decisions"("source_event_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_expenses_source_event_id_key" ON "project_expenses"("source_event_id");

-- CreateIndex
CREATE INDEX "project_expenses_project_id_status_idx" ON "project_expenses"("project_id", "status");

-- CreateIndex
CREATE INDEX "project_summaries_project_id_generated_at_idx" ON "project_summaries"("project_id", "generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "spaces_organization_id_slug_key" ON "spaces"("organization_id", "slug");

-- CreateIndex
CREATE UNIQUE INDEX "space_availability_rules_space_id_weekday_opens_at_key" ON "space_availability_rules"("space_id", "weekday", "opens_at");

-- CreateIndex
CREATE INDEX "space_blocks_space_id_start_at_idx" ON "space_blocks"("space_id", "start_at");

-- CreateIndex
CREATE INDEX "booking_occurrences_space_id_start_at_idx" ON "booking_occurrences"("space_id", "start_at");

-- CreateIndex
CREATE INDEX "reminders_active_next_run_at_idx" ON "reminders"("active", "next_run_at");

-- CreateIndex
CREATE INDEX "bill_occurrences_organization_id_status_due_date_idx" ON "bill_occurrences"("organization_id", "status", "due_date");

-- CreateIndex
CREATE UNIQUE INDEX "bill_occurrences_recurring_bill_id_competence_key" ON "bill_occurrences"("recurring_bill_id", "competence");

-- CreateIndex
CREATE UNIQUE INDEX "payment_attachments_bill_occurrence_id_sha256_key" ON "payment_attachments"("bill_occurrence_id", "sha256");

-- CreateIndex
CREATE UNIQUE INDEX "notification_schedules_dedupe_key_key" ON "notification_schedules"("dedupe_key");

-- CreateIndex
CREATE INDEX "notification_schedules_status_scheduled_for_idx" ON "notification_schedules"("status", "scheduled_for");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_idempotency_key_key" ON "notification_deliveries"("idempotency_key");

-- CreateIndex
CREATE INDEX "notification_deliveries_status_available_at_idx" ON "notification_deliveries"("status", "available_at");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_key_key" ON "idempotency_records"("scope", "key");

-- CreateIndex
CREATE INDEX "ai_executions_organization_id_created_at_idx" ON "ai_executions"("organization_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_entity_type_entity_id_idx" ON "audit_events"("organization_id", "entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_events_organization_id_created_at_idx" ON "audit_events"("organization_id", "created_at");

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_members" ADD CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_instances" ADD CONSTRAINT "whatsapp_instances_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whatsapp_groups" ADD CONSTRAINT "whatsapp_groups_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "whatsapp_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_instance_id_fkey" FOREIGN KEY ("instance_id") REFERENCES "whatsapp_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "whatsapp_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_channels" ADD CONSTRAINT "project_channels_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_channels" ADD CONSTRAINT "project_channels_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_channels" ADD CONSTRAINT "project_channels_whatsapp_group_id_fkey" FOREIGN KEY ("whatsapp_group_id") REFERENCES "whatsapp_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_events" ADD CONSTRAINT "project_events_ai_execution_id_fkey" FOREIGN KEY ("ai_execution_id") REFERENCES "ai_executions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_tasks" ADD CONSTRAINT "project_tasks_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "project_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_decisions" ADD CONSTRAINT "project_decisions_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "project_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_expenses" ADD CONSTRAINT "project_expenses_source_event_id_fkey" FOREIGN KEY ("source_event_id") REFERENCES "project_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_summaries" ADD CONSTRAINT "project_summaries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_summaries" ADD CONSTRAINT "project_summaries_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaces" ADD CONSTRAINT "spaces_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_availability_rules" ADD CONSTRAINT "space_availability_rules_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_blocks" ADD CONSTRAINT "space_blocks_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "space_blocks" ADD CONSTRAINT "space_blocks_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_occurrences" ADD CONSTRAINT "booking_occurrences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_occurrences" ADD CONSTRAINT "booking_occurrences_booking_id_fkey" FOREIGN KEY ("booking_id") REFERENCES "bookings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "booking_occurrences" ADD CONSTRAINT "booking_occurrences_space_id_fkey" FOREIGN KEY ("space_id") REFERENCES "spaces"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_bills" ADD CONSTRAINT "recurring_bills_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_occurrences" ADD CONSTRAINT "bill_occurrences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bill_occurrences" ADD CONSTRAINT "bill_occurrences_recurring_bill_id_fkey" FOREIGN KEY ("recurring_bill_id") REFERENCES "recurring_bills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attachments" ADD CONSTRAINT "payment_attachments_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_attachments" ADD CONSTRAINT "payment_attachments_bill_occurrence_id_fkey" FOREIGN KEY ("bill_occurrence_id") REFERENCES "bill_occurrences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_schedules" ADD CONSTRAINT "notification_schedules_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_schedule_id_fkey" FOREIGN KEY ("schedule_id") REFERENCES "notification_schedules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_executions" ADD CONSTRAINT "ai_executions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
