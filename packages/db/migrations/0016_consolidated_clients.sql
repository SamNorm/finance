CREATE TYPE "public"."entity_kind" AS ENUM('borrower', 'consolidated');--> statement-breakpoint
CREATE TABLE "consolidated_statements" (
	"period_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"member_period_id" uuid NOT NULL,
	CONSTRAINT "consolidated_statements_period_id_member_id_pk" PRIMARY KEY("period_id","member_id")
);
--> statement-breakpoint
ALTER TABLE "consolidated_statements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "consolidation_members" (
	"entity_id" uuid NOT NULL,
	"member_id" uuid NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "consolidation_members_entity_id_member_id_pk" PRIMARY KEY("entity_id","member_id"),
	CONSTRAINT "consolidation_members_not_itself" CHECK ("consolidation_members"."entity_id" <> "consolidation_members"."member_id")
);
--> statement-breakpoint
ALTER TABLE "consolidation_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "kind" "entity_kind" DEFAULT 'borrower' NOT NULL;--> statement-breakpoint
ALTER TABLE "statement_periods" ADD COLUMN "eliminations" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "consolidated_statements" ADD CONSTRAINT "consolidated_statements_period_id_statement_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."statement_periods"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidated_statements" ADD CONSTRAINT "consolidated_statements_member_id_entities_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidated_statements" ADD CONSTRAINT "consolidated_statements_member_period_id_statement_periods_id_fk" FOREIGN KEY ("member_period_id") REFERENCES "public"."statement_periods"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_members" ADD CONSTRAINT "consolidation_members_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consolidation_members" ADD CONSTRAINT "consolidation_members_member_id_entities_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."entities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consolidated_statements_member_period" ON "consolidated_statements" USING btree ("member_period_id");--> statement-breakpoint
CREATE INDEX "consolidation_members_member" ON "consolidation_members" USING btree ("member_id");