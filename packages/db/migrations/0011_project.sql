ALTER TABLE "analyses" ADD COLUMN "post_project_keys" text[];--> statement-breakpoint
ALTER TABLE "analysis_scenarios" ADD COLUMN "project" jsonb;--> statement-breakpoint
ALTER TABLE "scoring_models" ADD COLUMN "financing_items" jsonb DEFAULT '{"longTermDebt":null,"currentDebt":null,"cash":null}'::jsonb NOT NULL;