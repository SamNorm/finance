ALTER TABLE "analyses" ADD COLUMN "charts" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "financial_model_versions" ADD COLUMN "charts" jsonb DEFAULT '[]'::jsonb NOT NULL;