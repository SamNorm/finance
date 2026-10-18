CREATE TABLE "documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entity_id" uuid NOT NULL,
	"analysis_id" uuid,
	"scenario_id" uuid,
	"title" text NOT NULL,
	"template" text NOT NULL,
	"definition" jsonb NOT NULL,
	"data" jsonb NOT NULL,
	"data_hash" text NOT NULL,
	"financial_model_version_id" uuid,
	"pdf" "bytea" NOT NULL,
	"pages" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "branding" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_financial_model_version_id_financial_model_versions_id_fk" FOREIGN KEY ("financial_model_version_id") REFERENCES "public"."financial_model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_organization" ON "documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "documents_entity" ON "documents" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "documents_analysis" ON "documents" USING btree ("analysis_id");--> statement-breakpoint
CREATE INDEX "documents_financial_model_version" ON "documents" USING btree ("financial_model_version_id");