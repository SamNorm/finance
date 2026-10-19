CREATE TABLE "borrowing_base_templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"based_on" text,
	"draft" jsonb NOT NULL,
	"published" jsonb,
	"published_at" timestamp with time zone,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "borrowing_base_templates_published_at" CHECK (("borrowing_base_templates"."published" is null) = ("borrowing_base_templates"."published_at" is null))
);
--> statement-breakpoint
ALTER TABLE "borrowing_base_templates" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "borrowing_base_templates" ADD CONSTRAINT "borrowing_base_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "borrowing_base_templates_organization" ON "borrowing_base_templates" USING btree ("organization_id");