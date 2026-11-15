CREATE TYPE "public"."billing_interval" AS ENUM('month', 'year');--> statement-breakpoint
CREATE TYPE "public"."billing_provider" AS ENUM('stripe', 'lemonsqueezy', 'moyasar', 'manual');--> statement-breakpoint
CREATE TYPE "public"."key_kind" AS ENUM('desktop', 'api');--> statement-breakpoint
CREATE TYPE "public"."key_status" AS ENUM('active', 'revoked');--> statement-breakpoint
CREATE TYPE "public"."plan_tier" AS ENUM('free', 'starter', 'pro', 'team');--> statement-breakpoint
CREATE TYPE "public"."pool_key_status" AS ENUM('active', 'disabled', 'auth_failed');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'canceled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."upstream_api_type" AS ENUM('openai-chat-completions', 'anthropic-messages', 'openai-responses', 'google-generative-ai');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('user', 'admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"metadata" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" "billing_provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subscription_id" uuid NOT NULL,
	"delta_credits" bigint NOT NULL,
	"reason" text NOT NULL,
	"admin_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "desktop_auth_codes" (
	"code_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"state" text NOT NULL,
	"code_challenge" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"os" text NOT NULL,
	"app_version" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_prices" (
	"model" text NOT NULL,
	"input_per_mtok" bigint NOT NULL,
	"cached_input_per_mtok" bigint NOT NULL,
	"output_per_mtok" bigint NOT NULL,
	"effective_from" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "model_prices_model_effective_from_pk" PRIMARY KEY("model","effective_from")
);
--> statement-breakpoint
CREATE TABLE "model_routes" (
	"model" text NOT NULL,
	"provider_id" text NOT NULL,
	"api_type" "upstream_api_type" NOT NULL,
	"upstream_model" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "model_routes_model_provider_id_pk" PRIMARY KEY("model","provider_id")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" text PRIMARY KEY NOT NULL,
	"tier" "plan_tier" NOT NULL,
	"name_en" text NOT NULL,
	"name_ar" text NOT NULL,
	"price_cents" integer NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"interval" "billing_interval" DEFAULT 'month' NOT NULL,
	"credits_per_period" bigint NOT NULL,
	"rpm_limit" integer NOT NULL,
	"max_concurrent_streams" integer NOT NULL,
	"allowed_models" text[] DEFAULT '{}'::text[] NOT NULL,
	"max_output_tokens" integer,
	"past_due_grace_hours" integer DEFAULT 72 NOT NULL,
	"fallback_enabled" boolean DEFAULT false NOT NULL,
	"max_keys" integer DEFAULT 5 NOT NULL,
	"max_devices" integer DEFAULT 3 NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_price_ck" CHECK ("plans"."price_cents" >= 0),
	CONSTRAINT "plans_credits_ck" CHECK ("plans"."credits_per_period" >= 0),
	CONSTRAINT "plans_currency_ck" CHECK (char_length("plans"."currency") = 3)
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"plan_id" text NOT NULL,
	"status" "subscription_status" NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"credits_limit" bigint NOT NULL,
	"credits_used" bigint DEFAULT 0 NOT NULL,
	"billing_provider" "billing_provider" DEFAULT 'manual' NOT NULL,
	"provider_subscription_id" text,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subscriptions_credits_used_ck" CHECK ("subscriptions"."credits_used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "upstream_pool_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_id" text NOT NULL,
	"label" text NOT NULL,
	"key_ciphertext" "bytea" NOT NULL,
	"key_nonce" "bytea" NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"key_fingerprint" text NOT NULL,
	"status" "pool_key_status" DEFAULT 'active' NOT NULL,
	"weight" integer DEFAULT 1 NOT NULL,
	"max_concurrency" integer DEFAULT 8 NOT NULL,
	"supported_models" text[],
	"total_requests" bigint DEFAULT 0 NOT NULL,
	"total_429" bigint DEFAULT 0 NOT NULL,
	"total_5xx" bigint DEFAULT 0 NOT NULL,
	"last_error_at" timestamp with time zone,
	"last_error_code" text,
	"last_used_at" timestamp with time zone,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "upstream_pool_keys_weight_ck" CHECK ("upstream_pool_keys"."weight" > 0),
	CONSTRAINT "upstream_pool_keys_concurrency_ck" CHECK ("upstream_pool_keys"."max_concurrency" > 0)
);
--> statement-breakpoint
CREATE TABLE "upstream_providers" (
	"id" text PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"base_urls" jsonb NOT NULL,
	"session_header" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"is_fallback" boolean DEFAULT false NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_daily" (
	"user_id" uuid NOT NULL,
	"day" date NOT NULL,
	"model" text NOT NULL,
	"requests" integer DEFAULT 0 NOT NULL,
	"input_tokens" bigint DEFAULT 0 NOT NULL,
	"output_tokens" bigint DEFAULT 0 NOT NULL,
	"credits_charged" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_daily_user_id_day_model_pk" PRIMARY KEY("user_id","day","model")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"name" text,
	"password_hash" text,
	"locale" text DEFAULT 'en' NOT NULL,
	"role" "user_role" DEFAULT 'user' NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_locale_ck" CHECK ("users"."locale" in ('ar', 'en'))
);
--> statement-breakpoint
CREATE TABLE "virtual_api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"last4" text NOT NULL,
	"name" text NOT NULL,
	"kind" "key_kind" DEFAULT 'api' NOT NULL,
	"device_id" uuid,
	"status" "key_status" DEFAULT 'active' NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "virtual_api_keys_hash_ck" CHECK ("virtual_api_keys"."key_hash" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_adjustments" ADD CONSTRAINT "credit_adjustments_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_adjustments" ADD CONSTRAINT "credit_adjustments_admin_id_users_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "desktop_auth_codes" ADD CONSTRAINT "desktop_auth_codes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_routes" ADD CONSTRAINT "model_routes_provider_id_upstream_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."upstream_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "upstream_pool_keys" ADD CONSTRAINT "upstream_pool_keys_provider_id_upstream_providers_id_fk" FOREIGN KEY ("provider_id") REFERENCES "public"."upstream_providers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_daily" ADD CONSTRAINT "usage_daily_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_api_keys" ADD CONSTRAINT "virtual_api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "virtual_api_keys" ADD CONSTRAINT "virtual_api_keys_device_id_devices_id_fk" FOREIGN KEY ("device_id") REFERENCES "public"."devices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_provider_event_uq" ON "billing_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "devices_user_idx" ON "devices" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_live_per_user_uq" ON "subscriptions" USING btree ("user_id") WHERE "subscriptions"."status" in ('trialing', 'active', 'past_due');--> statement-breakpoint
CREATE INDEX "subscriptions_user_created_idx" ON "subscriptions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "upstream_pool_keys_provider_idx" ON "upstream_pool_keys" USING btree ("provider_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_uq" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "virtual_api_keys_hash_uq" ON "virtual_api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "virtual_api_keys_user_idx" ON "virtual_api_keys" USING btree ("user_id");