ALTER TABLE "protected_payments" ADD COLUMN IF NOT EXISTS "paid_out_by" uuid;--> statement-breakpoint
ALTER TABLE "protected_payments" ADD COLUMN IF NOT EXISTS "payout_reference" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "protected_payments" ADD CONSTRAINT "protected_payments_paid_out_by_users_id_fk" FOREIGN KEY ("paid_out_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
