-- Regras de integridade que o Prisma não expressa no schema.
-- Mantidas em migration própria para ficarem fáceis de auditar.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Intervalos sempre válidos: start_at < end_at.
ALTER TABLE "booking_occurrences"
  ADD CONSTRAINT "booking_occurrences_valid_interval" CHECK ("start_at" < "end_at");
ALTER TABLE "space_blocks"
  ADD CONSTRAINT "space_blocks_valid_interval" CHECK ("start_at" < "end_at");

-- Nenhuma sobreposição de ocorrências ativas (não canceladas) na mesma sala.
-- Garantido pelo banco mesmo com requisições concorrentes; intervalo semiaberto [start, end)
-- permite reservas encostadas (14h–17h e 17h–19h).
ALTER TABLE "booking_occurrences"
  ADD CONSTRAINT "booking_occurrences_no_overlap"
  EXCLUDE USING gist (
    "space_id" WITH =,
    tstzrange("start_at", "end_at", '[)') WITH &&
  ) WHERE ("status" <> 'cancelled');

-- Contas: dia de vencimento 1..31 (meses curtos vencem no último dia, regra aplicada no domínio).
ALTER TABLE "recurring_bills"
  ADD CONSTRAINT "recurring_bills_due_day_range" CHECK ("due_day" BETWEEN 1 AND 31);
ALTER TABLE "recurring_bills"
  ADD CONSTRAINT "recurring_bills_reminder_interval" CHECK ("overdue_reminder_every_days" >= 1);

-- Competência no formato YYYY-MM e valores monetários não negativos.
ALTER TABLE "bill_occurrences"
  ADD CONSTRAINT "bill_occurrences_competence_format" CHECK ("competence" ~ '^\d{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "bill_occurrences"
  ADD CONSTRAINT "bill_occurrences_amounts_non_negative"
  CHECK ("paid_amount_cents" >= 0 AND ("expected_amount_cents" IS NULL OR "expected_amount_cents" >= 0));
ALTER TABLE "project_expenses"
  ADD CONSTRAINT "project_expenses_amount_non_negative" CHECK ("amount_cents" IS NULL OR "amount_cents" >= 0);

-- Despesa paga precisa de comprovação: comprovante anexado ou confirmação explícita registrada.
ALTER TABLE "project_expenses"
  ADD CONSTRAINT "project_expenses_paid_requires_evidence"
  CHECK ("status" <> 'paid' OR "proof_attachment_id" IS NOT NULL OR "confirmed_by_phone" IS NOT NULL);

-- Funcionamento das salas: weekday ISO 1..7 e horários HH:mm com abertura < fechamento.
ALTER TABLE "space_availability_rules"
  ADD CONSTRAINT "space_availability_rules_weekday" CHECK ("weekday" BETWEEN 1 AND 7);
ALTER TABLE "space_availability_rules"
  ADD CONSTRAINT "space_availability_rules_hours"
  CHECK ("opens_at" ~ '^([01]\d|2[0-3]):[0-5]\d$' AND "closes_at" ~ '^([01]\d|2[0-3]):[0-5]\d$' AND "opens_at" < "closes_at");

-- Outbox: tentativas não negativas.
ALTER TABLE "notification_deliveries"
  ADD CONSTRAINT "notification_deliveries_attempts" CHECK ("attempts" >= 0 AND "max_attempts" >= 1);
