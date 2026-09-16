-- Activación manual de la prueba PRO de 14 días.
-- - users.trial_used_at: la prueba es UNA SOLA vez por propietario.
-- - stores.trial_started_at deja de existir al crear la tienda (ya no es
--   "ahora" por defecto): solo se fija cuando el comerciante activa el trial.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "trial_used_at" timestamp;
ALTER TABLE "stores" ALTER COLUMN "trial_started_at" DROP NOT NULL;
ALTER TABLE "stores" ALTER COLUMN "trial_started_at" DROP DEFAULT;