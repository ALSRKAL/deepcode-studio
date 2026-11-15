import { db } from "../db";
import { env } from "../env";
import type { BillingProvider } from "./types";
import { MockBillingProvider } from "./mock";
import { StripeBillingProvider } from "./stripe";
import { UpiBillingProvider } from "./upi";

/** One provider per process, chosen by BILLING_PROVIDER (docs/plan/03 §5.1). */
export function billingProvider(): BillingProvider {
  const handle = db();
  switch (env.BILLING_PROVIDER) {
    case "stripe":
      return new StripeBillingProvider({ db: handle.db });
    case "upi":
      return new UpiBillingProvider({ db: handle.db, appUrl: env.APP_URL });
    case "mock":
    default:
      return new MockBillingProvider({ db: handle.db, appUrl: env.APP_URL });
  }
}
