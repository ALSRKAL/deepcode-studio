CREATE TYPE "public"."upi_payment_status" AS ENUM('awaiting_payment', 'submitted', 'approved', 'rejected', 'expired');--> statement-breakpoint
ALTER TYPE "public"."billing_provider" ADD VALUE 'upi';--> statement-breakpoint
CREATE TABLE "upi_payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"reference" text NOT NULL,
	"amount_minor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" "upi_payment_status" DEFAULT 'awaiting_payment' NOT NULL,
	"utr" text,
	"submitted_at" timestamp with time zone,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" text,
	"reject_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upi_payments_amount_ck" CHECK ("upi_payments"."amount_minor" > 0)
);
--> statement-breakpoint
ALTER TABLE "upi_payments" ADD CONSTRAINT "upi_payments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upi_payments" ADD CONSTRAINT "upi_payments_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "upi_payments_reference_uq" ON "upi_payments" USING btree ("reference");--> statement-breakpoint
CREATE UNIQUE INDEX "upi_payments_utr_uq" ON "upi_payments" USING btree ("utr");--> statement-breakpoint
CREATE INDEX "upi_payments_status_idx" ON "upi_payments" USING btree ("status","created_at");