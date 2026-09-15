ALTER TABLE "messages" ADD COLUMN "removed_at" timestamp;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "removed_reason" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "terms_accepted_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "moderation_status" text DEFAULT 'ACTIVE' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "moderation_until" timestamp;