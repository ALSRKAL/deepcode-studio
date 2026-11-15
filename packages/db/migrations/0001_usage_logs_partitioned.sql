-- Hand-written: drizzle-kit cannot express partitioning. Keep in sync with src/schema/usage.ts.
-- usage_logs is range-partitioned by month (docs/plan/02 §3). No prompt or completion
-- content is stored here, only token counts and metadata.
CREATE TYPE "public"."usage_status" AS ENUM('ok', 'client_abort', 'upstream_error', 'rejected');--> statement-breakpoint
CREATE TABLE "usage_logs" (
	"request_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"key_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"pool_key_id" uuid,
	"provider_id" text,
	"model" text NOT NULL,
	"api_type" text NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cached_input_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"credits_charged" bigint DEFAULT 0 NOT NULL,
	"estimated" boolean DEFAULT false NOT NULL,
	"status" "usage_status" NOT NULL,
	"http_status" integer NOT NULL,
	"ttfb_ms" integer,
	"duration_ms" integer,
	"retries" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "usage_logs_pk" PRIMARY KEY ("request_id", "created_at")
) PARTITION BY RANGE ("created_at");--> statement-breakpoint
CREATE INDEX "usage_logs_user_created_idx" ON "usage_logs" ("user_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "usage_logs_key_created_idx" ON "usage_logs" ("key_id", "created_at" DESC);--> statement-breakpoint
CREATE INDEX "usage_logs_pool_key_created_idx" ON "usage_logs" ("pool_key_id", "created_at" DESC);--> statement-breakpoint
-- Catches rows outside pre-created months so an insert never fails. The gateway keeps
-- months pre-created ahead of time, so this partition should stay empty; if it does
-- not, creating that month's partition fails until the rows are moved.
CREATE TABLE "usage_logs_default" PARTITION OF "usage_logs" DEFAULT;--> statement-breakpoint
CREATE OR REPLACE FUNCTION ensure_usage_log_partitions(months_ahead integer DEFAULT 2)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
	i integer;
	month_start timestamptz;
	partition_name text;
BEGIN
	FOR i IN 0..months_ahead LOOP
		month_start := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + make_interval(months => i);
		partition_name := 'usage_logs_' || to_char(month_start AT TIME ZONE 'UTC', 'YYYY_MM');
		EXECUTE format(
			'CREATE TABLE IF NOT EXISTS %I PARTITION OF usage_logs FOR VALUES FROM (%L) TO (%L)',
			partition_name,
			month_start,
			month_start + interval '1 month'
		);
	END LOOP;
END;
$$;--> statement-breakpoint
SELECT ensure_usage_log_partitions(2);
