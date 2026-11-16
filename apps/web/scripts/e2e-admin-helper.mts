/**
 * Server-side half of the desktop UI e2e (apps/desktop/scripts/ci/deepcode-account-ui-e2e.mjs).
 * Plays the user's browser and the admin, with the same library code the website's
 * buttons use, against the THROWAWAY deepcode_e2e database only.
 *
 *   signup <email> <password> <name>         create + verify a website account
 *   approve <email> <state> <challenge> <device>   consent screen "Allow" → prints the one-time code
 *   plan <email> <planId>                      admin assigns a plan
 *   exhaust <email> | topup <email>            admin adjusts credits to 0 / +1M
 *   expire <email>                             the live subscription (e.g. the free trial) ends now
 *   devices <email>                            prints the device count
 */
import { desc, eq, sql } from "drizzle-orm";
import { users, subscriptions, devices } from "@deepcode/db";
import { db } from "../src/lib/db";
import { createDesktopAuthCode } from "../src/lib/desktopAuth";
import { assignPlan, adjustCredits } from "../src/lib/adminActions";
import { invalidateGateway } from "../src/lib/gateway";

if (!/deepcode_e2e/.test(process.env.DATABASE_URL ?? "")) throw new Error("refusing to run outside the deepcode_e2e database");
const BASE = (process.env.BASE ?? "http://localhost:10090").replace(/\/$/, "");
const handle = db().db;
const [cmd, email, ...rest] = process.argv.slice(2);

async function userId(e: string) {
  const [u] = await handle.select().from(users).where(eq(users.email, e));
  if (!u) throw new Error(`no user ${e}`);
  return u.id;
}
async function adminId() {
  const [a] = await handle.select().from(users).where(eq(users.role, "admin"));
  if (a) return a.id;
  const e = `e2e-admin-${Date.now()}@deepcode.local`;
  await fetch(`${BASE}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ name: "E2E Admin", email: e, password: `Adm-${Date.now()}-pw` }),
  });
  await handle.update(users).set({ role: "admin" }).where(eq(users.email, e));
  return userId(e);
}

switch (cmd) {
  case "signup": {
    const [password, name] = rest;
    const res = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: BASE },
      body: JSON.stringify({ name, email, password }),
    });
    await handle.update(users).set({ emailVerified: true }).where(eq(users.email, email!));
    console.log(res.status);
    break;
  }
  case "approve": {
    const [state, challenge, device] = rest;
    const { code } = await createDesktopAuthCode(handle, await userId(email!), { state: state!, codeChallenge: challenge!, deviceName: device!, os: "linux" });
    console.log(code);
    break;
  }
  case "plan": {
    const id = await userId(email!);
    const r = await assignPlan(handle, { id: await adminId() }, { userId: id, planId: rest[0]!, days: 30 });
    await invalidateGateway({ userIds: [id] });
    console.log(JSON.stringify(r));
    break;
  }
  case "exhaust":
  case "topup": {
    const id = await userId(email!);
    // The live subscription (a new account also has its ended/canceled trial row).
    const [sub] = await handle
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userId, id))
      .orderBy(desc(sql`(${subscriptions.status} in ('trialing','active','past_due'))`), desc(subscriptions.createdAt))
      .limit(1);
    const delta = cmd === "topup" ? 1_000_000 : -(Number(sub!.creditsLimit) - Number(sub!.creditsUsed));
    const r = await adjustCredits(handle, { id: await adminId() }, { subscriptionId: sub!.id, deltaCredits: delta, reason: `e2e ${cmd}` });
    await invalidateGateway({ userIds: [id] });
    console.log(JSON.stringify(r));
    break;
  }
  case "expire": {
    const id = await userId(email!);
    await handle.update(subscriptions).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(subscriptions.userId, id));
    await invalidateGateway({ userIds: [id] });
    console.log("expired");
    break;
  }
  case "devices": {
    console.log((await handle.select().from(devices).where(eq(devices.userId, await userId(email!)))).length);
    break;
  }
  default:
    throw new Error(`unknown command ${cmd}`);
}
process.exit(0);
