CREATE TABLE IF NOT EXISTS "order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"unit_price" numeric(10, 2) NOT NULL,
	"quantity" numeric(10, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"note" text,
	"sale_id" uuid
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "store_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"comment" text,
	"image_url" text
);
--> statement-breakpoint
ALTER TABLE "appointments" ALTER COLUMN "customer_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ALTER COLUMN "trial_started_at" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "stores" ALTER COLUMN "trial_started_at" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ALTER COLUMN "schedule" SET DEFAULT '{"openTime":"08:00","closeTime":"21:00","lunchStart":"12:00","lunchEnd":"13:00","workingDays":[1,2,3,4,5,6],"bookingHorizonDays":30,"timezone":"America/Bogota"}'::jsonb;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "manual_customer_name" text;--> statement-breakpoint
ALTER TABLE "appointments" ADD COLUMN "sale_id" uuid;--> statement-breakpoint
ALTER TABLE "sale_items" ADD COLUMN "service_id" uuid;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "origin" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "trial_used_at" timestamp;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "orders" ADD CONSTRAINT "orders_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "store_reviews" ADD CONSTRAINT "store_reviews_customer_id_users_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "store_reviews_customer_store_unique" ON "store_reviews" USING btree ("customer_id","store_id");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "appointments" ADD CONSTRAINT "appointments_sale_id_sales_id_fk" FOREIGN KEY ("sale_id") REFERENCES "public"."sales"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_service_id_store_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."store_services"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
