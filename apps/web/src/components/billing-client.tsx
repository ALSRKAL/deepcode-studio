"use client";

import { useTranslations } from "next-intl";
import { cancelSubscriptionAction, startCheckoutAction } from "@/actions/billing";

export function ChoosePlanButton({ planId, label }: { planId: string; label: string }) {
  return (
    <form action={startCheckoutAction}>
      <input type="hidden" name="planId" value={planId} />
      <button
        type="submit"
        className="inline-flex h-9 w-full items-center justify-center rounded-sm bg-primary px-4 text-[14px] text-primary-fg font-medium hover:bg-primary-hover"
      >
        {label}
      </button>
    </form>
  );
}

export function CancelButton({ atPeriodEnd }: { atPeriodEnd: boolean }) {
  const t = useTranslations("billing");
  return (
    <form action={cancelSubscriptionAction}>
      <input type="hidden" name="atPeriodEnd" value={atPeriodEnd ? "true" : "false"} />
      <button
        type="submit"
        className="inline-flex h-9 items-center rounded-sm border border-danger/40 px-4 text-[14px] text-danger hover:bg-danger/10"
      >
        {atPeriodEnd ? t("cancelAtPeriodEnd") : t("cancelNow")}
      </button>
    </form>
  );
}

export function PortalButton() {
  const t = useTranslations("billing");
  // The provider-hosted portal appears once the real provider is connected; in
  // mock mode the button is hidden (no portal concept locally).
  if (process.env.BILLING_PROVIDER !== "stripe") return null;
  return (
    <span className="inline-flex h-9 items-center text-[14px] text-fg-muted">
      {t("managePortal")}
    </span>
  );
}
