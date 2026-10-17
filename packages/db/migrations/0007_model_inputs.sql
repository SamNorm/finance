ALTER TYPE "public"."financial_model_line_kind" ADD VALUE 'input';--> statement-breakpoint
CREATE TABLE "model_input_values" (
	"period_id" uuid NOT NULL,
	"code" text NOT NULL,
	"amount" numeric,
	"text" text,
	CONSTRAINT "model_input_values_period_id_code_pk" PRIMARY KEY("period_id","code"),
	CONSTRAINT "model_input_values_one_kind" CHECK (("model_input_values"."amount" is null) <> ("model_input_values"."text" is null))
);
--> statement-breakpoint
ALTER TABLE "model_input_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "financial_model_lines" ADD COLUMN "breaks_down" text;--> statement-breakpoint
ALTER TABLE "model_input_values" ADD CONSTRAINT "model_input_values_period_id_statement_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."statement_periods"("id") ON DELETE cascade ON UPDATE no action;