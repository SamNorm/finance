CREATE TYPE "public"."item_aggregation" AS ENUM('add', 'subtract', 'ignore');--> statement-breakpoint
CREATE TYPE "public"."item_data_type" AS ENUM('amount', 'percent', 'ratio', 'count', 'date', 'text');--> statement-breakpoint
CREATE TYPE "public"."item_kind" AS ENUM('input', 'subtotal', 'header');--> statement-breakpoint
CREATE TYPE "public"."item_sign" AS ENUM('any', 'positive', 'negative');--> statement-breakpoint
CREATE TYPE "public"."scoring_model_source" AS ENUM('mirrored', 'native');--> statement-breakpoint
CREATE TYPE "public"."statement_type" AS ENUM('balance_sheet', 'income_statement', 'cash_flow', 'other');--> statement-breakpoint
CREATE TYPE "public"."version_status" AS ENUM('draft', 'published', 'retired');--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scoring_model_items" (
	"version_id" uuid NOT NULL,
	"code" text NOT NULL,
	"label" text NOT NULL,
	"statement" "statement_type" NOT NULL,
	"parent_code" text,
	"position" integer NOT NULL,
	"kind" "item_kind" DEFAULT 'input' NOT NULL,
	"data_type" "item_data_type" DEFAULT 'amount' NOT NULL,
	"aggregation" "item_aggregation" DEFAULT 'add' NOT NULL,
	"expected_sign" "item_sign" DEFAULT 'any' NOT NULL,
	"description" text,
	"attributes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "scoring_model_items_version_id_code_pk" PRIMARY KEY("version_id","code")
);
--> statement-breakpoint
ALTER TABLE "scoring_model_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scoring_model_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scoring_model_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"status" "version_status" DEFAULT 'draft' NOT NULL,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	CONSTRAINT "scoring_model_versions_published_at" CHECK (("scoring_model_versions"."status" = 'draft') = ("scoring_model_versions"."published_at" is null))
);
--> statement-breakpoint
ALTER TABLE "scoring_model_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "scoring_models" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"source" "scoring_model_source" NOT NULL,
	"source_system" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "scoring_models" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scoring_model_items" ADD CONSTRAINT "scoring_model_items_version_id_scoring_model_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."scoring_model_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_model_items" ADD CONSTRAINT "scoring_model_items_parent" FOREIGN KEY ("version_id","parent_code") REFERENCES "public"."scoring_model_items"("version_id","code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_model_versions" ADD CONSTRAINT "scoring_model_versions_scoring_model_id_scoring_models_id_fk" FOREIGN KEY ("scoring_model_id") REFERENCES "public"."scoring_models"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scoring_models" ADD CONSTRAINT "scoring_models_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "scoring_model_items_position" ON "scoring_model_items" USING btree ("version_id","position");--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_model_versions_number" ON "scoring_model_versions" USING btree ("scoring_model_id","number");--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_model_versions_one_draft" ON "scoring_model_versions" USING btree ("scoring_model_id") WHERE "scoring_model_versions"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "scoring_models_one_per_organization" ON "scoring_models" USING btree ("organization_id");