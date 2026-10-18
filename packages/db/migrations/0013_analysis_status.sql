CREATE TYPE "public"."analysis_status" AS ENUM('in_progress', 'completed');--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "status" "analysis_status" DEFAULT 'in_progress' NOT NULL;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "completed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_completed_at" CHECK (("analyses"."status" = 'completed') = ("analyses"."completed_at" is not null));