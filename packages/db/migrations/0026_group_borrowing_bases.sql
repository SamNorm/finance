CREATE TABLE "group_borrowing_base_months" (
	"entity_id" uuid NOT NULL,
	"month" text NOT NULL,
	"adjustments" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"override" jsonb,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_borrowing_base_months_entity_id_month_pk" PRIMARY KEY("entity_id","month")
);
--> statement-breakpoint
ALTER TABLE "group_borrowing_base_months" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "group_borrowing_base_months" ADD CONSTRAINT "group_borrowing_base_months_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;