CREATE TYPE "public"."borrowing_base_quality" AS ENUM('reported', 'verified');--> statement-breakpoint
CREATE TABLE "borrowing_base_months" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"line_id" uuid NOT NULL,
	"month" text NOT NULL,
	"quality" "borrowing_base_quality" DEFAULT 'reported' NOT NULL,
	"received_on" date,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "borrowing_base_months_month" CHECK ("borrowing_base_months"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "borrowing_base_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "borrowing_base_values" (
	"month_id" uuid NOT NULL,
	"code" text NOT NULL,
	"amount" numeric NOT NULL,
	CONSTRAINT "borrowing_base_values_month_id_code_pk" PRIMARY KEY("month_id","code")
);
--> statement-breakpoint
ALTER TABLE "borrowing_base_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "credit_lines" ADD COLUMN "borrowing_base" jsonb;--> statement-breakpoint
ALTER TABLE "credit_lines" ADD COLUMN "certificate_due_days" integer;--> statement-breakpoint
ALTER TABLE "borrowing_base_months" ADD CONSTRAINT "borrowing_base_months_line_id_credit_lines_id_fk" FOREIGN KEY ("line_id") REFERENCES "public"."credit_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrowing_base_values" ADD CONSTRAINT "borrowing_base_values_month_id_borrowing_base_months_id_fk" FOREIGN KEY ("month_id") REFERENCES "public"."borrowing_base_months"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "borrowing_base_months_line_month" ON "borrowing_base_months" USING btree ("line_id","month");