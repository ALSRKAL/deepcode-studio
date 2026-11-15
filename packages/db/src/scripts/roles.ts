/**
 * Least-privilege database roles (docs/plan/02 §3). Idempotent; run AFTER migrations:
 *   pnpm --filter @deepcode/db roles        (uses DATABASE_URL as the admin connection)
 *
 * Creates two NOLOGIN group roles. The environment then creates login users and
 * grants membership, e.g. `CREATE USER gateway_app ...; GRANT gateway_rw TO gateway_app;`
 * and connects the gateway/web with those users. The dev compose `deepcode` superuser
 * is unaffected.
 *
 *   gateway_rw (the gateway): SELECT on everything except users.password_hash;
 *     INSERT into usage_logs (+ its partitions) and usage_daily; UPDATE only
 *     subscriptions.credits_used, virtual_api_keys.last_used_at, the health columns
 *     of upstream_pool_keys and the rollup columns of usage_daily (settlement upserts).
 *     It cannot write plans or read users.password_hash.
 *
 *   web_rw (the web portal): full read/write on the app tables EXCEPT it cannot read
 *     upstream_pool_keys.key_ciphertext / key_nonce (write-only by design) and cannot
 *     write usage tables or subscriptions.credits_used (single writer: the gateway).
 *
 * Column grants are computed from information_schema, so running the script after a
 * migration that adds columns keeps working; re-run it after NEW TABLES are added.
 *
 * ensure_usage_log_partitions is recreated here so future partitions are granted to
 * both roles when the roles exist; migration 0001 keeps the un-granting version, so
 * re-run this script after every migration round (also recorded in the deploy runbook).
 */
import { createDatabase, type DatabaseHandle } from "../index.js";

const USAGE_LOGS = "usage_logs";
const USAGE_DAILY = "usage_daily";

/** Tables a role must never read at all (whole-table SELECT deny). */
const TABLE_SELECT_DENY: Record<string, string[]> = {
  // The gateway authenticates with virtual keys only; auth/session material is
  // the web's domain and the gateway needs none of it.
  gateway_rw: ["auth_accounts", "auth_sessions", "auth_verifications", "desktop_auth_codes"],
  web_rw: [],
};

/** Columns a role must never read, per table. The rest get a column-level SELECT. */
const SELECT_DENY: Record<string, Record<string, string[]>> = {
  gateway_rw: { users: ["password_hash"] },
  web_rw: {
    upstream_pool_keys: ["key_ciphertext", "key_nonce"],
    // Credentials live in auth_accounts (better-auth); the users copy is unused.
    users: ["password_hash"],
  },
};

/** Tables web_rw may INSERT but never UPDATE or DELETE (append-only records). */
const WEB_APPEND_ONLY = ["audit_logs", "billing_events"];

/** UPDATE allowlist, per role and table. Tables not listed get no UPDATE for gateway_rw. */
const UPDATE_ALLOW: Record<string, Record<string, string[] | "all">> = {
  gateway_rw: {
    subscriptions: ["credits_used", "updated_at"],
    virtual_api_keys: ["last_used_at"],
    upstream_pool_keys: [
      "status",
      "total_requests",
      "total_429",
      "total_5xx",
      "last_error_at",
      "last_error_code",
      "last_used_at",
      "updated_at",
    ],
    // settlement upserts rollups with ON CONFLICT DO UPDATE
    usage_daily: ["requests", "input_tokens", "output_tokens", "credits_charged"],
  },
  web_rw: {}, // filled dynamically: every table except usage tables; subscriptions minus credits_used
};

export async function applyDatabaseRoles(handle: DatabaseHandle): Promise<void> {
  const sql = handle.sql;

  await sql.unsafe(`
    DO $do$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'gateway_rw') THEN
        CREATE ROLE gateway_rw NOLOGIN;
      END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'web_rw') THEN
        CREATE ROLE web_rw NOLOGIN;
      END IF;
    END $do$;
  `);

  await sql.unsafe(`GRANT USAGE ON SCHEMA public TO gateway_rw, web_rw;`);

  // Partition tables of usage_logs (they are regular tables to the grant system, so
  // grants on the parent do not cover them on PostgreSQL 16).
  const partitions = await sql<{ relname: string }[]>`
    SELECT c.relname FROM pg_inherits i
    JOIN pg_class c ON c.oid = i.inhrelid
    WHERE i.inhparent = 'public.usage_logs'::regclass`;
  const usageTables = [USAGE_LOGS, ...partitions.map((p) => p.relname)];

  const columns = await sql<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE table_schema = 'public' ORDER BY table_name, ordinal_position`;
  const colsOf = (table: string) => columns.filter((c) => c.table_name === table).map((c) => c.column_name);

  const quoteIdent = (id: string) => `"${id.replaceAll('"', '""')}"`;
  const colList = (table: string, names: string[]) => names.map((n) => quoteIdent(n)).join(", ");
  const grantCols = async (role: string, table: string, names: string[]) => {
    if (names.length === 0) return;
    await sql.unsafe(`REVOKE SELECT ON ${quoteIdent(table)} FROM ${role};`);
    await sql.unsafe(`GRANT SELECT (${colList(table, names)}) ON ${quoteIdent(table)} TO ${role};`);
  };

  // ---- gateway_rw -------------------------------------------------------------
  await sql.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO gateway_rw;`);
  for (const table of TABLE_SELECT_DENY.gateway_rw!) {
    await sql.unsafe(`REVOKE SELECT ON ${quoteIdent(table)} FROM gateway_rw;`);
  }
  for (const [table, denied] of Object.entries(SELECT_DENY.gateway_rw!)) {
    await grantCols("gateway_rw", table, colsOf(table).filter((c) => !denied.includes(c)));
  }
  await sql.unsafe(`GRANT INSERT ON ${usageTables.map(quoteIdent).join(", ")} TO gateway_rw;`);
  await sql.unsafe(`GRANT INSERT ON ${quoteIdent(USAGE_DAILY)} TO gateway_rw;`);
  for (const [table, allowed] of Object.entries(UPDATE_ALLOW.gateway_rw!)) {
    const list = allowed === "all" ? colsOf(table) : allowed.filter((c) => colsOf(table).includes(c));
    if (list.length > 0) {
      await sql.unsafe(`GRANT UPDATE (${colList(table, list)}) ON ${quoteIdent(table)} TO gateway_rw;`);
    }
  }

  // ---- web_rw -----------------------------------------------------------------
  await sql.unsafe(`GRANT SELECT ON ALL TABLES IN SCHEMA public TO web_rw;`);
  for (const [table, denied] of Object.entries(SELECT_DENY.web_rw!)) {
    await grantCols("web_rw", table, colsOf(table).filter((c) => !denied.includes(c)));
  }
  // Usage tables are gateway-written only.
  await sql.unsafe(
    `REVOKE INSERT, UPDATE, DELETE ON ${usageTables.map(quoteIdent).join(", ")}, ${quoteIdent(USAGE_DAILY)} FROM web_rw;`,
  );
  // Everything else: full DML, minus credits_used (single writer: the gateway) and
  // minus the pool-key ciphertext columns in UPDATE (they are insert-only for web).
  // Table names come from information_schema and the exclusion list from constants in
  // this file, so inlining them as literals is safe.
  const excluded = [...usageTables, USAGE_DAILY, ...WEB_APPEND_ONLY].map((t) => `'${t.replaceAll("'", "")}'`).join(", ");
  const writable = await sql<{ table_name: string }[]>`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
      AND table_name NOT IN (${sql.unsafe(excluded)})`;
  for (const { table_name: table } of writable) {
    await sql.unsafe(`GRANT INSERT, UPDATE, DELETE ON ${quoteIdent(table)} TO web_rw;`);
  }
  // Audit trail and webhook idempotency records: insert-only for the web process.
  for (const table of WEB_APPEND_ONLY) {
    await sql.unsafe(`GRANT INSERT, SELECT ON ${quoteIdent(table)} TO web_rw;`);
    await sql.unsafe(`REVOKE UPDATE, DELETE ON ${quoteIdent(table)} FROM web_rw;`);
  }
  const subCols = colsOf("subscriptions").filter((c) => c !== "credits_used");
  if (subCols.length > 0) {
    await sql.unsafe(`REVOKE UPDATE ON subscriptions FROM web_rw;`);
    await sql.unsafe(`GRANT UPDATE (${colList("subscriptions", subCols)}) ON subscriptions TO web_rw;`);
  }
  const poolUpdateCols = colsOf("upstream_pool_keys").filter(
    (c) => !SELECT_DENY.web_rw!.upstream_pool_keys!.includes(c),
  );
  if (poolUpdateCols.length > 0) {
    // REVOKE the table-level grant first: a column-level grant does not narrow it.
    await sql.unsafe(`REVOKE UPDATE ON upstream_pool_keys FROM web_rw;`);
    await sql.unsafe(`GRANT UPDATE (${colList("upstream_pool_keys", poolUpdateCols)}) ON upstream_pool_keys TO web_rw;`);
  }

  // ---- partitions created later ------------------------------------------------
  // Recreate the maintenance function so every new partition is granted to both
  // roles, and make it SECURITY DEFINER: the gateway (a gateway_rw member) calls
  // it at startup and every 6 hours, and creating partitions needs privileges
  // gateway_rw must not have. The owner is whoever runs this script (the
  // migrations role), EXECUTE stays with gateway_rw only.
  await sql.unsafe(`
    CREATE OR REPLACE FUNCTION ensure_usage_log_partitions(months_ahead integer DEFAULT 2)
    RETURNS void
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = pg_catalog, public
    AS $fn$
    DECLARE
      i integer;
      month_start timestamptz;
      partition_name text;
    BEGIN
      FOR i IN 0..months_ahead LOOP
        month_start := date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + make_interval(months => i);
        partition_name := 'usage_logs_' || to_char(month_start AT TIME ZONE 'UTC', 'YYYY_MM');
        EXECUTE format(
          'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.usage_logs FOR VALUES FROM (%L) TO (%L)',
          partition_name,
          month_start,
          month_start + interval '1 month'
        );
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gateway_rw') THEN
          EXECUTE format('GRANT SELECT, INSERT ON public.%I TO gateway_rw', partition_name);
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'web_rw') THEN
          EXECUTE format('GRANT SELECT ON public.%I TO web_rw', partition_name);
        END IF;
      END LOOP;
    END;
    $fn$;
  `);
  await sql.unsafe(`REVOKE EXECUTE ON FUNCTION ensure_usage_log_partitions(integer) FROM PUBLIC;`);
  await sql.unsafe(`GRANT EXECUTE ON FUNCTION ensure_usage_log_partitions(integer) TO gateway_rw;`);
  // Grant on partitions that already exist (the function above only covers new ones
  // created after this run, and idempotent CREATE TABLE IF NOT EXISTS does not re-grant).
  for (const p of partitions) {
    await sql.unsafe(`GRANT SELECT, INSERT ON ${quoteIdent(p.relname)} TO gateway_rw;`);
    await sql.unsafe(`GRANT SELECT ON ${quoteIdent(p.relname)} TO web_rw;`);
  }
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`${name} is not set (see .env.example)`);
    process.exit(1);
  }
  return value;
}

// CLI entry: `pnpm --filter @deepcode/db roles`
if (process.argv[1] && process.argv[1].endsWith("roles.ts")) {
  const handle = createDatabase(requireEnv("DATABASE_URL"), { max: 1 });
  try {
    await applyDatabaseRoles(handle);
    console.log("database roles applied: gateway_rw, web_rw");
  } finally {
    await handle.close();
  }
}
