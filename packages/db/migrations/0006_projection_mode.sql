CREATE TYPE "public"."projection_mode" AS ENUM('assumptions', 'client');--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "projection_mode" "projection_mode" DEFAULT 'assumptions' NOT NULL;