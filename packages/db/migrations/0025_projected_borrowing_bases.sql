CREATE TABLE "analysis_borrowing_base_values" (
	"analysis_id" uuid NOT NULL,
	"line_id" text NOT NULL,
	"month" text NOT NULL,
	"code" text NOT NULL,
	"amount" numeric NOT NULL,
	CONSTRAINT "analysis_borrowing_base_values_analysis_id_line_id_month_code_pk" PRIMARY KEY("analysis_id","line_id","month","code")
);
--> statement-breakpoint
ALTER TABLE "analysis_borrowing_base_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "analyses" ADD COLUMN "borrowing_bases" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_scenarios" ADD COLUMN "borrowing_bases" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "analysis_borrowing_base_values" ADD CONSTRAINT "analysis_borrowing_base_values_analysis_id_analyses_id_fk" FOREIGN KEY ("analysis_id") REFERENCES "public"."analyses"("id") ON DELETE cascade ON UPDATE no action;