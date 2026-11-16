ALTER TABLE "upstream_pool_keys" ADD COLUMN "quota_raw" jsonb;--> statement-breakpoint
ALTER TABLE "upstream_pool_keys" ADD COLUMN "quota_remaining_pct" integer;--> statement-breakpoint
ALTER TABLE "upstream_pool_keys" ADD COLUMN "quota_renews_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "upstream_pool_keys" ADD COLUMN "quota_checked_at" timestamp with time zone;