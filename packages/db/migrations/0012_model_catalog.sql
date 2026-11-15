CREATE TYPE "public"."catalog_model_status" AS ENUM('active', 'hidden', 'retired');--> statement-breakpoint
CREATE TABLE "catalog_models" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"family" text,
	"context_window" integer,
	"max_output_tokens" integer,
	"input_modalities" text[] DEFAULT '{}'::text[] NOT NULL,
	"capabilities" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"upstream_cost_usd" jsonb,
	"is_free" boolean DEFAULT false NOT NULL,
	"trains_on_data" boolean DEFAULT false NOT NULL,
	"status" "catalog_model_status" DEFAULT 'active' NOT NULL,
	"note" text,
	"badge" text,
	"sort_order" integer DEFAULT 100 NOT NULL,
	"source_provider_id" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "upstream_providers" ADD COLUMN "catalog_format" text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE "upstream_providers" ADD COLUMN "models_url" text;--> statement-breakpoint
ALTER TABLE "upstream_providers" ADD COLUMN "hide_model_pattern" text;--> statement-breakpoint
ALTER TABLE "upstream_providers" ADD COLUMN "last_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "catalog_models" ADD CONSTRAINT "catalog_models_source_provider_id_upstream_providers_id_fk" FOREIGN KEY ("source_provider_id") REFERENCES "public"."upstream_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "catalog_models_status_idx" ON "catalog_models" USING btree ("status","sort_order");