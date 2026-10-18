CREATE TABLE "document_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"financial_model_id" uuid,
	"based_on" text,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "document_templates_published_at" CHECK (("document_templates"."published" is null) = ("document_templates"."published_at" is null))
);
--> statement-breakpoint
ALTER TABLE "document_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "template_id" uuid;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_financial_model_id_financial_models_id_fk" FOREIGN KEY ("financial_model_id") REFERENCES "public"."financial_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "document_templates_organization" ON "document_templates" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "document_templates_financial_model" ON "document_templates" USING btree ("financial_model_id");--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_template" ON "documents" USING btree ("template_id");