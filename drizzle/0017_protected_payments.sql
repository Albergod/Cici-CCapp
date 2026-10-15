CREATE TYPE "public"."protected_status" AS ENUM('initiated', 'collected', 'held', 'released', 'paid_out', 'refunded', 'cancelled');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "protected_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"total" numeric(10, 2) NOT NULL,
	"buyer_fee" numeric(10, 2) NOT NULL,
	"seller_fee" numeric(10, 2) NOT NULL,
	"collected" numeric(10, 2),
	"seller_net" numeric(10, 2) NOT NULL,
	"status" "protected_status" DEFAULT 'initiated' NOT NULL,
	"wompi_tx_id" text,
	"released_at" timestamp,
	"paid_out_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "protected_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "protected_payments" ADD CONSTRAINT "protected_payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "protected_payments" ADD CONSTRAINT "protected_payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "protected_payments" ADD CONSTRAINT "protected_payments_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "protected_order_unique" ON "protected_payments" USING btree ("order_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "protected_tx_unique" ON "protected_payments" USING btree ("wompi_tx_id");