DROP INDEX "scoring_models_one_per_organization";--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "scoring_model_id" uuid;--> statement-breakpoint
-- Existing borrowers follow their organization's scoring model, the only one until now.
UPDATE "entities" SET "scoring_model_id" = (SELECT "id" FROM "scoring_models" WHERE "scoring_models"."organization_id" = "entities"."organization_id" ORDER BY "created_at" LIMIT 1);--> statement-breakpoint
ALTER TABLE "entities" ALTER COLUMN "scoring_model_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "naics_code" text;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "risk_rating" text;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_scoring_model_id_scoring_models_id_fk" FOREIGN KEY ("scoring_model_id") REFERENCES "public"."scoring_models"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "entities_scoring_model" ON "entities" USING btree ("scoring_model_id");--> statement-breakpoint
CREATE INDEX "scoring_models_organization" ON "scoring_models" USING btree ("organization_id");