CREATE TABLE IF NOT EXISTS "empresarios_leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"company_name" text NOT NULL,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"store_count" integer,
	"website" text,
	"message" text,
	"source" text DEFAULT 'landing' NOT NULL,
	"status" text DEFAULT 'NEW' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
