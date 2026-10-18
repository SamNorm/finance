ALTER TABLE "scoring_models" ADD COLUMN "check_items" jsonb DEFAULT '{"netIncome":null,"retainedEarnings":null}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "statement_periods" ADD COLUMN "reported_net_income" numeric;--> statement-breakpoint
ALTER TABLE "statement_periods" ADD COLUMN "reconciliation" jsonb DEFAULT '[]'::jsonb NOT NULL;