-- Valor do período (4h) das salas e das reservas.
ALTER TABLE "spaces" ADD COLUMN     "period_rate_cents" INTEGER;
ALTER TABLE "bookings" ADD COLUMN     "period_rate_cents" INTEGER;
