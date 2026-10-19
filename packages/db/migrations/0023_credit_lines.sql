CREATE TABLE "credit_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"currency" text DEFAULT 'CAD' NOT NULL,
	"limit" jsonb NOT NULL,
	"rate" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"closed_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credit_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "line_usage" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_scenarios" ADD COLUMN "lines" jsonb;--> statement-breakpoint
ALTER TABLE "analysis_scenarios" ADD COLUMN "line_usage" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "credit_lines" ADD CONSTRAINT "credit_lines_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credit_lines_entity" ON "credit_lines" USING btree ("entity_id","position");--> statement-breakpoint
-- A project's line of credit increases become the scenario's proposed lines,
-- each a new line of its increase, with its average usage assumed.
UPDATE "analysis_scenarios" SET
  "lines" = (
    SELECT jsonb_agg(jsonb_build_object(
      'id', l->>'id',
      'name', l->>'name',
      'currency', 'CAD',
      'limit', jsonb_build_object('value', l->>'increase'),
      'rate', l->>'rate'))
    FROM jsonb_array_elements("project"->'lines') AS l),
  "line_usage" = "line_usage" || (
    SELECT jsonb_object_agg(l->>'id', jsonb_build_object('share', l->>'usage'))
    FROM jsonb_array_elements("project"->'lines') AS l)
WHERE jsonb_typeof("project"->'lines') = 'array'
  AND jsonb_array_length("project"->'lines') > 0;
--> statement-breakpoint
UPDATE "analysis_scenarios" SET "project" = "project" - 'lines'
WHERE "project" IS NOT NULL;
