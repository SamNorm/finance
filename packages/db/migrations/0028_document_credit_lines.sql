ALTER TABLE "documents" ADD COLUMN "credit_line_id" uuid;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_credit_line_id_credit_lines_id_fk" FOREIGN KEY ("credit_line_id") REFERENCES "public"."credit_lines"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_credit_line" ON "documents" USING btree ("credit_line_id");