ALTER TABLE "analysis_scenarios" ADD COLUMN "covenants" jsonb;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "covenants" jsonb DEFAULT '[]'::jsonb NOT NULL;