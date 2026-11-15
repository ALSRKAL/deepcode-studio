import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, inject } from "vitest";
import { createDatabase, users } from "@deepcode/db";

/** W-01: sign-up → verify → sign-in; enumeration-safe errors; rate limits. */
describe("auth flows (W-01)", () => {
  const handle = createDatabase(inject("databaseUrl"), { max: 2 });
  const mailApiUrl = inject("mailApiUrl");
  let auth: (typeof import("@/lib/auth"))["auth"];

  beforeAll(async () => {
    ({ auth } = await import("@/lib/auth"));
  });

  afterAll(async () => {
    await handle.close();
  });

  /** Fetches the latest mail to `to` from the Mailpit catcher and returns its text. */
  async function mailBodyFor(to: string): Promise<string> {
    for (let i = 0; i < 20; i += 1) {
      const res = await fetch(`${mailApiUrl}/api/v1/messages?limit=20`);
      const data = (await res.json()) as { messages: Array<{ ID: string; To: Array<{ Address: string }>; Subject: string }> };
      const match = data.messages.find((m) => m.To.some((t) => t.Address === to));
      if (match) {
        const detail = (await (await fetch(`${mailApiUrl}/api/v1/message/${match.ID}`)).json()) as { Text: string };
        return detail.Text;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    throw new Error(`no mail arrived for ${to}`);
  }

  it("sign-up creates an unverified user and delivers a verification mail", async () => {
    const email = `w01-${randomUUID().slice(0, 8)}@test.local`;
    await auth.api.signUpEmail({ body: { name: "W01", email, password: "correct horse battery" } });
    const [user] = await handle.db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    expect(user).toBeTruthy();
    expect(user!.emailVerified).toBe(false);
    const text = await mailBodyFor(email);
    expect(text).toMatch(/verify-email\?token=/);
  });

  it("sign-in is refused before verification and allowed after; errors are enumeration-safe", async () => {
    const email = `w01b-${randomUUID().slice(0, 8)}@test.local`;
    const password = "correct horse battery";

    // Unverified sign-in is refused (requireEmailVerification).
    await auth.api.signUpEmail({ body: { name: "W01b", email, password } });
    const refused = await auth.api.signInEmail({ body: { email, password } }).catch((e: Error) => e.message);
    expect(refused).toMatch(/not verified|EMAIL_NOT_VERIFIED|verify/i);

    // Verify through the token the app emailed (Mailpit catcher). The token is a
    // JWT (contains dots) and ends at the next query parameter.
    const text = await mailBodyFor(email);
    const token = /token=([^&\s]+)/.exec(text)?.[1];
    expect(token).toBeTruthy();
    // autoSignInAfterVerification makes the endpoint answer with a redirect;
    // the call surfaces that as an APIError with status FOUND, not a failure.
    const verification = await auth.api
      .verifyEmail({ query: { token: token!, callbackURL: "/" } })
      .then(() => "ok")
      .catch((e: { status?: string }) => String(e.status ?? e));
    expect(verification === "ok" || verification === "FOUND").toBe(true);
    const [verifiedUser] = await handle.db.select().from(users).where(sql`lower(${users.email}) = ${email}`);
    expect(verifiedUser!.emailVerified).toBe(true);

    const session = await auth.api.signInEmail({ body: { email, password } });
    expect(session.token).toBeTruthy();

    // Enumeration safety: unknown account and wrong password return the same class.
    const unknown = await auth.api
      .signInEmail({ body: { email: `ghost-${randomUUID()}@test.local`, password } })
      .catch((e: Error) => e.message);
    const wrong = await auth.api
      .signInEmail({ body: { email, password: "not-the-password-xx" } })
      .catch((e: Error) => e.message);
    expect(unknown).toMatch(/Invalid email or password|invalid_credentials/i);
    expect(wrong).toMatch(/Invalid email or password|invalid_credentials/i);
  });

  it("rate limits repeated failed sign-ins (through the HTTP handler)", async () => {
    // better-auth's limiter runs in the request middleware, not on direct
    // auth.api calls — so this exercises the mounted route handler.
    const email = `w01c-${randomUUID().slice(0, 8)}@test.local`;
    await auth.api.signUpEmail({ body: { name: "W01c", email, password: "correct horse battery" } });
    const { POST } = await import("@/app/api/auth/[...all]/route.js");
    let lastStatus = 0;
    for (let i = 0; i < 25; i += 1) {
      const res = await POST(
        new Request("http://localhost:3210/api/auth/sign-in/email", {
          method: "POST",
          headers: { "content-type": "application/json", "x-forwarded-for": "10.90.0.7" },
          body: JSON.stringify({ email, password: `wrong-${i}-xx` }),
        }),
      );
      lastStatus = res.status;
    }
    expect(lastStatus).toBe(429);
  });
});
