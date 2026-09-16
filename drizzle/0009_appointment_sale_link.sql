ALTER TABLE "sale_items" ADD COLUMN IF NOT EXISTS "service_id" uuid;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN IF NOT EXISTS "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN IF NOT EXISTS "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_service_id_store_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."store_services"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION WHEN duplicate_object THEN null; END $$;
