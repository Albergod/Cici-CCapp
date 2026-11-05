ALTER TABLE "orders" ADD COLUMN "stock_reserved" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "guest_reported_at" timestamp;