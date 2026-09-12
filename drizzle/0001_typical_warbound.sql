ALTER TABLE "products" ADD COLUMN "views" numeric(10, 0) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "stores" ADD COLUMN "referred_by_store_id" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "ref_code" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "stores" ADD CONSTRAINT "stores_referred_by_store_id_stores_id_fk" FOREIGN KEY ("referred_by_store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
