CREATE TYPE "public"."statement_quality" AS ENUM('audited', 'review', 'compilation', 'internal', 'projected');--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"industry" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "entities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "statement_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"period_end" date NOT NULL,
	"months" integer DEFAULT 12 NOT NULL,
	"quality" "statement_quality" NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"consolidated" boolean DEFAULT false NOT NULL,
	"scoring_model_version_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "statement_periods_months" CHECK ("statement_periods"."months" between 1 and 24)
);
--> statement-breakpoint
ALTER TABLE "statement_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "statement_values" (
	"period_id" uuid NOT NULL,
	"code" text NOT NULL,
	"amount" numeric,
	"text" text,
	CONSTRAINT "statement_values_period_id_code_pk" PRIMARY KEY("period_id","code"),
	CONSTRAINT "statement_values_one_kind" CHECK (("statement_values"."amount" is null) <> ("statement_values"."text" is null))
);
--> statement-breakpoint
ALTER TABLE "statement_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_periods" ADD CONSTRAINT "statement_periods_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_periods" ADD CONSTRAINT "statement_periods_scoring_model_version_id_scoring_model_versions_id_fk" FOREIGN KEY ("scoring_model_version_id") REFERENCES "public"."scoring_model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_values" ADD CONSTRAINT "statement_values_period_id_statement_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."statement_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_organization" ON "entities" USING btree ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "statement_periods_unique" ON "statement_periods" USING btree ("entity_id","period_end","months");--> statement-breakpoint
CREATE INDEX "statement_periods_scoring_model_version" ON "statement_periods" USING btree ("scoring_model_version_id");