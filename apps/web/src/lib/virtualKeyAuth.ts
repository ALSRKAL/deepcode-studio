import { eq } from "drizzle-orm";
import { virtualApiKeys, users } from "@deepcode/db";
import { hashVirtualKey } from "@deepcode/shared/node/keys";
import { db } from "@/lib/db";

/**
 * Virtual-key authentication for desktop-facing web API routes (client configs,
 * skill archives). Same HMAC pepper as the gateway; a snapshot cache is unnecessary
 * at this traffic level, and reading the key row keeps revocation immediate.
 */
export interface VirtualKeyContext {
  keyId: string;
  keyHash: string;
  userId: string;
  userStatus: "active" | "suspended";
}

export async function authenticateVirtualKey(request: Request): Promise<VirtualKeyContext | null> {
  const auth = request.headers.get("authorization");
  const key = auth?.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : null;
  if (!key || !key.startsWith("sk-dc-")) return null;
  const pepper = Buffer.from(process.env.KEY_HASH_PEPPER ?? "", "base64");
  if (pepper.length < 32) return null;
  const keyHash = hashVirtualKey(key, pepper).toString("hex");
  const [row] = await db()
    .db.select({ key: virtualApiKeys, userStatus: users.status })
    .from(virtualApiKeys)
    .innerJoin(users, eq(users.id, virtualApiKeys.userId))
    .where(eq(virtualApiKeys.keyHash, keyHash))
    .limit(1);
  if (!row || row.key.status !== "active") return null;
  return {
    keyId: row.key.id,
    keyHash,
    userId: row.key.userId,
    userStatus: row.userStatus,
  };
}
