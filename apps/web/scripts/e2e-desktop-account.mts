/**
 * End-to-end check of the desktop ↔ account ↔ gateway chain against a running
 * server (the production image), using the same code paths the app and the admin
 * buttons use. Run against a THROWAWAY database only:
 *
 *   BASE=http://localhost:10080 DATABASE_URL=…/deepcode_e2e GATEWAY_URL=http://127.0.0.1:8790 \
 *   KEY_HASH_PEPPER=… AUTH_SECRET=… GATEWAY_INTERNAL_TOKEN=… \
 *   node --conditions=@deepcode/source --import tsx scripts/e2e-desktop-account.mts
 *
 * Steps: sign-up → consent page → device code → exchange (device key) → no-plan
 * lock → admin assigns plan → plan models → real completion through the gateway
 * (credits charged) → model outside plan refused → credits exhausted → admin
 * top-up → RPM limit → device limit → sign-out revokes → suspended user refused.
 */
import { createHash, randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { subscriptions, plans, users, devices } from "@deepcode/db";
import { db } from "../src/lib/db";
import { createDesktopAuthCode } from "../src/lib/desktopAuth";
import { assignPlan, adjustCredits, setUserStatus } from "../src/lib/adminActions";
import { invalidateGateway } from "../src/lib/gateway";

const BASE = (process.env.BASE ?? "http://localhost:10080").replace(/\/$/, "");
if (!/deepcode_e2e/.test(process.env.DATABASE_URL ?? "")) throw new Error("refusing to run outside the deepcode_e2e database");
const handle = db().db;
let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? `  — ${detail}` : ""}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const json = async (res: Response) => {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
const b64url = (b: Buffer) => b.toString("base64url");

// ---- 1. account -----------------------------------------------------------
const email = `e2e-${Date.now()}@deepcode.local`;
const password = b64url(randomBytes(18));
const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ name: "E2E User", email, password }),
});
check("sign-up", signUp.ok, String(signUp.status));
const [user] = await handle.select().from(users).where(eq(users.email, email));
await handle.update(users).set({ emailVerified: true }).where(eq(users.id, user!.id));
const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ email, password }),
});
const cookie = (signIn.headers.get("set-cookie") ?? "").split(";")[0]!;
check("sign-in after email verification", signIn.ok && cookie.includes("session_token"), String(signIn.status));

// ---- 2. desktop sign-in (PKCE) --------------------------------------------
const pkce = () => {
  const verifier = b64url(randomBytes(32));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()) };
};
async function desktopSignIn(deviceName: string) {
  const { verifier, challenge } = pkce();
  const state = b64url(randomBytes(16));
  const consent = await fetch(
    `${BASE}/ar/auth/desktop?state=${state}&code_challenge=${challenge}&device_name=${encodeURIComponent(deviceName)}&os=linux`,
    { headers: { cookie }, redirect: "manual" },
  );
  const page = await consent.text();
  const { code } = await createDesktopAuthCode(handle, user!.id, { state, codeChallenge: challenge, deviceName, os: "linux" });
  const res = await fetch(`${BASE}/api/desktop/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code, code_verifier: verifier, device: { name: deviceName, os: "linux", app_version: "e2e" } }),
  });
  return { consentStatus: consent.status, consentHasEmail: page.includes(email), status: res.status, body: await json(res) };
}
const first = await desktopSignIn("Laptop");
check("consent page renders for the signed-in user", first.consentStatus === 200 && first.consentHasEmail, String(first.consentStatus));
check("exchange returns a device key", first.status === 200 && /^sk-dc-/.test(first.body.apiKey ?? ""), String(first.status));
check("exchange returns the account identity", first.body.user?.email === email && first.body.user?.name === "E2E User");
check("gateway base URL points at this server", first.body.gatewayBaseUrl?.startsWith(`${BASE}/v1`) ?? false, first.body.gatewayBaseUrl);
const key = first.body.apiKey as string;
const gw = (path: string, init: RequestInit = {}, k = key) =>
  fetch(`${BASE}${path}`, { ...init, headers: { authorization: `Bearer ${k}`, "content-type": "application/json", ...(init.headers ?? {}) } });

// ---- 3. no plan yet ---------------------------------------------------------
const st0 = await gw("/v1/subscription/status");
const st0b = await json(st0);
check("no plan: status reports a lock, not an error page", st0.status < 500, `${st0.status} ${JSON.stringify(st0b).slice(0, 120)}`);
const chat = (model: string, k = key) =>
  gw("/v1/chat/completions", { method: "POST", body: JSON.stringify({ model, messages: [{ role: "user", content: "hi" }] }) }, k);
const noPlan = await chat("glm-5.3-flash");
check("no plan: completion refused", noPlan.status === 402 || noPlan.status === 403, String(noPlan.status));

// ---- 4. admin assigns Starter --------------------------------------------------
// A separate admin account (an admin cannot suspend themselves: cannot_self).
const adminEmail = `e2e-admin-${Date.now()}@deepcode.local`;
await fetch(`${BASE}/api/auth/sign-up/email`, {
  method: "POST",
  headers: { "content-type": "application/json", origin: BASE },
  body: JSON.stringify({ name: "E2E Admin", email: adminEmail, password: b64url(randomBytes(18)) }),
});
const [adminRow] = await handle.select().from(users).where(eq(users.email, adminEmail));
await handle.update(users).set({ role: "admin" }).where(eq(users.id, adminRow!.id));
const admin = { id: adminRow!.id };
const assigned = await assignPlan(handle, admin, { userId: user!.id, planId: "starter-monthly", days: 30 });
await invalidateGateway({ userIds: [user!.id] });
check("admin assigns Starter", assigned.ok);
const st1 = await json(await gw("/v1/subscription/status"));
check("status shows the plan and credits", JSON.stringify(st1).includes("starter") || JSON.stringify(st1).includes("Starter"), JSON.stringify(st1).slice(0, 160));
const [plan] = await handle.select().from(plans).where(eq(plans.id, "starter-monthly"));
const models = await json(await gw("/v1/models"));
const ids: string[] = (models.data ?? []).map((m: { id: string }) => m.id);
check(
  "models = exactly the plan's servable models",
  ids.length > 0 && ids.every((id) => plan!.allowedModels.includes(id)),
  ids.join(", "),
);

// ---- 5. real request, credits charged -------------------------------------
const [subBefore] = await handle.select().from(subscriptions).where(eq(subscriptions.userId, user!.id));
// A paid model, so the charge is visible (free models cost 0 credits by design).
const paid = ids.find((id) => !id.endsWith("-free")) ?? ids[0]!;
const ok = await chat(paid);
const okBody = await json(ok);
check("completion through the gateway", ok.status === 200 && !!okBody.choices, `${ok.status} ${paid}`);
await sleep(2500);
const [subAfter] = await handle.select().from(subscriptions).where(eq(subscriptions.userId, user!.id));
check(
  "credits charged for the request",
  Number(subAfter!.creditsUsed) > Number(subBefore!.creditsUsed),
  `${subBefore!.creditsUsed} → ${subAfter!.creditsUsed}`,
);
const outside = await chat("grok-4.7");
check("model outside the plan refused (403)", outside.status === 403, String(outside.status));

// ---- 6. credits exhausted, admin top-up ------------------------------------
const remaining = Number(subAfter!.creditsLimit) - Number(subAfter!.creditsUsed);
await adjustCredits(handle, admin, { subscriptionId: subAfter!.id, deltaCredits: -remaining, reason: "e2e exhaust" });
await invalidateGateway({ userIds: [user!.id] });
const exhausted = await chat(ids[0]!);
check("credits exhausted → 402 quota_exhausted", exhausted.status === 402, `${exhausted.status} ${JSON.stringify(await json(exhausted)).slice(0, 100)}`);
await adjustCredits(handle, admin, { subscriptionId: subAfter!.id, deltaCredits: 1_000_000, reason: "e2e top-up" });
await invalidateGateway({ userIds: [user!.id] });
const topped = await chat(ids[0]!);
check("admin top-up restores access", topped.status === 200, String(topped.status));

// ---- 7. RPM limit -------------------------------------------------------------
await handle.update(plans).set({ rpmLimit: 3 }).where(eq(plans.id, "starter-monthly"));
await invalidateGateway({ userIds: [user!.id], reloadCatalog: true });
await sleep(61_000); // fresh RPM window
const burst = [];
for (let i = 0; i < 5; i++) burst.push((await chat(ids[0]!)).status);
check("RPM limit enforced (429 after the plan's limit)", burst.includes(429) && burst.filter((s) => s === 200).length <= 3, burst.join(","));
await handle.update(plans).set({ rpmLimit: plan!.rpmLimit }).where(eq(plans.id, "starter-monthly"));
await invalidateGateway({ userIds: [user!.id], reloadCatalog: true });

// ---- 8. device limit (Starter = 2) ----------------------------------------
const second = await desktopSignIn("Desktop");
check("second device allowed", second.status === 200, String(second.status));
const third = await desktopSignIn("Third PC");
check("third device refused (device_limit)", third.status === 403 && third.body.error?.code === "device_limit", `${third.status} ${JSON.stringify(third.body)}`);

// ---- 9. sign-out revokes the key and frees the slot --------------------------------
const out = await gw("/api/desktop/device", { method: "DELETE" });
check("desktop sign-out", out.ok, String(out.status));
await sleep(500);
const afterOut = await chat(ids[0]!);
check("signed-out key refused", afterOut.status === 401, String(afterOut.status));
const devs = await handle.select().from(devices).where(eq(devices.userId, user!.id));
check("sign-out freed the device slot", devs.length === 1, `${devs.length} device(s) left`);
const again = await desktopSignIn("Laptop again");
check("signing in again works after sign-out", again.status === 200, String(again.status));

// ---- 10. suspended user ----------------------------------------------------------
const suspendedOutcome = await setUserStatus(handle, admin, { userId: user!.id, status: "suspended" });
check("admin suspends the user", suspendedOutcome.ok, JSON.stringify(suspendedOutcome));
await invalidateGateway({ userIds: [user!.id] });
const suspended = await chat(ids[0]!, again.body.apiKey);
check("suspended user refused (401)", suspended.status === 401, String(suspended.status));

const usage = await handle.execute(sql`select count(*)::int as n from usage_logs where user_id = ${user!.id}`);
console.log(`usage log rows: ${(usage as unknown as Array<{ n: number }>)[0]?.n ?? JSON.stringify(usage)}`);
console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
