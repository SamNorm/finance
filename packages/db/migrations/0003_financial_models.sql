CREATE TYPE "public"."financial_model_line_format" AS ENUM('amount', 'percent', 'ratio', 'count', 'flag', 'text');--> statement-breakpoint
CREATE TYPE "public"."financial_model_line_kind" AS ENUM('assumption', 'calculation', 'header');--> statement-breakpoint
CREATE TABLE "financial_model_lines" (
	"version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"kind" "financial_model_line_kind" NOT NULL,
	"position" integer NOT NULL,
	"format" "financial_model_line_format" DEFAULT 'amount' NOT NULL,
	"formula" text,
	"projection_formula" text,
	"default_value" text,
	"description" text,
	CONSTRAINT "financial_model_lines_version_id_code_pk" PRIMARY KEY("version_id","code")
);
--> statement-breakpoint
ALTER TABLE "financial_model_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "financial_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"financial_model_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "version_status" DEFAULT 'draft' NOT NULL,
	"scoring_model_version_id" uuid NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "financial_model_versions_published_at" CHECK (("financial_model_versions"."status" = 'draft') = ("financial_model_versions"."published_at" is null))
);
--> statement-breakpoint
ALTER TABLE "financial_model_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "financial_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"variant_of_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "financial_models" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "financial_model_lines" ADD CONSTRAINT "financial_model_lines_version_id_financial_model_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."financial_model_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_versions" ADD CONSTRAINT "financial_model_versions_financial_model_id_financial_models_id_fk" FOREIGN KEY ("financial_model_id") REFERENCES "public"."financial_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_model_versions" ADD CONSTRAINT "financial_model_versions_scoring_model_version_id_scoring_model_versions_id_fk" FOREIGN KEY ("scoring_model_version_id") REFERENCES "public"."scoring_model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_models" ADD CONSTRAINT "financial_models_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "financial_models" ADD CONSTRAINT "financial_models_variant_of_id_financial_models_id_fk" FOREIGN KEY ("variant_of_id") REFERENCES "public"."financial_models"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "financial_model_lines_position" ON "financial_model_lines" USING btree ("version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_model_versions_number" ON "financial_model_versions" USING btree ("financial_model_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "financial_model_versions_one_draft" ON "financial_model_versions" USING btree ("financial_model_id") WHERE "financial_model_versions"."status" = 'draft';--> statement-breakpoint
CREATE INDEX "financial_model_versions_scoring_model_version" ON "financial_model_versions" USING btree ("scoring_model_version_id");--> statement-breakpoint
CREATE INDEX "financial_models_organization" ON "financial_models" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "financial_models_variant_of" ON "financial_models" USING btree ("variant_of_id");