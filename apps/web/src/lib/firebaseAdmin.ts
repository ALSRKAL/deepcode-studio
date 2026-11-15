import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getMessaging } from "firebase-admin/messaging";
import { env } from "./env";

/**
 * Firebase Admin for the owner's existing admin phone app (the smm admin app).
 * DeepCode does not store payments in Firebase: Firebase is only used to
 *  - verify that a request from the phone app comes from a signed-in admin
 *    (ID token + `users/{uid}.role == "admin"`, the same rule the app uses), and
 *  - push "new payment" notifications to the app's admin topic.
 * Everything is optional: without credentials, push is skipped and the phone API
 * answers 503, while the web admin panel keeps working.
 */
const APP_NAME = "deepcode-admin-phone";

function adminApp(): App | null {
  const existing = getApps().find((a) => a.name === APP_NAME);
  if (existing) return existing;
  const projectId = env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  if (!projectId || !clientEmail || !privateKey) return null;
  return initializeApp({ credential: cert({ projectId, clientEmail, privateKey }), projectId }, APP_NAME);
}

export function firebaseAdminConfigured(): boolean {
  return adminApp() !== null;
}

export interface PhoneAdmin {
  uid: string;
  email: string | null;
}

/** Verifies `Authorization: Bearer <Firebase ID token>` and the admin role. */
export async function verifyPhoneAdmin(request: Request): Promise<PhoneAdmin | null> {
  const app = adminApp();
  if (!app) return null;
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token || token.startsWith("sk-dc-")) return null;
  try {
    const decoded = await getAuth(app).verifyIdToken(token, true);
    const profile = await getFirestore(app).collection("users").doc(decoded.uid).get();
    if (profile.get("role") !== "admin") return null;
    return { uid: decoded.uid, email: decoded.email ?? null };
  } catch {
    return null;
  }
}

/** Best-effort push to the admin topic; never throws (a payment must not fail on push). */
export async function pushToAdmins(message: {
  title: string;
  body: string;
  data: Record<string, string>;
}): Promise<boolean> {
  const app = adminApp();
  if (!app) return false;
  try {
    await getMessaging(app).send({
      topic: env.ADMIN_PUSH_TOPIC,
      notification: { title: message.title, body: message.body },
      data: message.data,
      android: { priority: "high", notification: { channelId: "admin_alerts", sound: "default" } },
      apns: { payload: { aps: { sound: "default" } } },
    });
    return true;
  } catch (error) {
    console.warn("[upi] admin push failed:", error instanceof Error ? error.message : "unknown");
    return false;
  }
}

/**
 * Cross-check against the owner's other project (smm `deposits`): the same bank
 * account receives both, so a UTR already claimed there must not also activate a
 * DeepCode plan. Returns null when it cannot be checked (not configured / error).
 */
export async function utrSeenInSmmDeposits(utr: string): Promise<boolean | null> {
  const app = adminApp();
  if (!app) return null;
  try {
    const snap = await getFirestore(app).collection("deposits").where("utr", "==", utr).limit(1).get();
    return !snap.empty;
  } catch {
    return null;
  }
}

/**
 * Marks a UTR as claimed by DeepCode in the shared Firestore (`external_utrs/{utr}`)
 * so the smm deposit API refuses the same bank transfer. Best effort; no-op when
 * Firebase is not configured. Only the Admin SDK can read/write this collection.
 */
export async function markUtrClaimed(utr: string, paymentId: string): Promise<void> {
  const app = adminApp();
  if (!app) return;
  try {
    await getFirestore(app)
      .collection("external_utrs")
      .doc(utr)
      .set({ source: "deepcode", paymentId, createdAt: new Date() });
  } catch (error) {
    console.warn("[upi] could not record UTR in Firestore:", error instanceof Error ? error.message : "unknown");
  }
}

export async function releaseUtrClaim(utr: string): Promise<void> {
  const app = adminApp();
  if (!app) return;
  try {
    await getFirestore(app).collection("external_utrs").doc(utr).delete();
  } catch {
    // Best effort.
  }
}
