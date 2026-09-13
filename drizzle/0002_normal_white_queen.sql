CREATE TYPE "public"."business_type" AS ENUM('ROPA', 'CALZADO', 'ACCESORIOS', 'HOGAR', 'ALIMENTOS', 'SERVICIOS', 'OTRO');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "mp_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"mp_payment_id" text NOT NULL,
	"status" text NOT NULL,
	"plan" "plan_type" NOT NULL,
	"cycle" "subscription_cycle" NOT NULL,
	"amount" numeric(10, 2) NOT NULL,
	"processed_at" timestamp DEFAULT now() NOT NULL,
	"store_id" uuid,
	"user_id" uuid
);
--> statement-breakpoint
ALTER TABLE "stores" DROP CONSTRAINT "stores_referred_by_store_id_stores_id_fk";
--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "asserted_product_id" uuid;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "customer_last_read_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "store_owner_last_read_at" timestamp;--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "cart_items" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "ai_generated" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "wa_text" text;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "stock" numeric(10, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "attributes" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "whatsapp" text;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "business_type" "business_type" DEFAULT 'OTRO' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_payments" ADD CONSTRAINT "mp_payments_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "mp_payments" ADD CONSTRAINT "mp_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "mp_payments_mp_payment_id_unique" ON "mp_payments" USING btree ("mp_payment_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "conversations" ADD CONSTRAINT "conversations_asserted_product_id_products_id_fk" FOREIGN KEY ("asserted_product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
