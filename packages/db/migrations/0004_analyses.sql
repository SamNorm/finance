CREATE TABLE "analyses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"financial_model_version_id" uuid NOT NULL,
	"name" text NOT NULL,
	"period_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"projection_years" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "analyses_projection_years" CHECK ("analyses"."projection_years" between 0 and 10)
);
--> statement-breakpoint
ALTER TABLE "analyses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "analysis_scenarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"analysis_id" uuid NOT NULL,
	"name" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "analysis_scenarios" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analyses" ADD CONSTRAINT "analyses_financial_model_version_id_financial_model_versions_id_fk" FOREIGN KEY ("financial_model_version_id") REFERENCES "public"."financial_model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "analysis_scenarios" ADD CONSTRAINT "analysis_scenarios_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "analyses_organization" ON "analyses" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "analyses_entity" ON "analyses" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "analyses_financial_model_version" ON "analyses" USING btree ("financial_model_version_id");--> statement-breakpoint
CREATE INDEX "analysis_scenarios_analysis" ON "analysis_scenarios" USING btree ("analysis_id","position");