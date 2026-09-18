-- Citas agendadas a mano por el comerciante (modo manual, disponible en FREE).
-- - customer_id deja de ser obligatorio: el comerciante puede agendar para un
--   cliente sin cuenta (walk-in / teléfono).
-- - manual_customer_name guarda el nombre del cliente cuando no hay user.
ALTER TABLE "appointments" ALTER COLUMN "customer_id" DROP NOT NULL;
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "manual_customer_name" text;
