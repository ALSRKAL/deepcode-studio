"use client";

import { useTranslations } from "next-intl";
import { revokeDeviceAction } from "@/actions/devices";

export function DeviceRevokeButton({ deviceId }: { deviceId: string }) {
  const t = useTranslations("devices");
  return (
    <form action={revokeDeviceAction}>
      <input type="hidden" name="deviceId" value={deviceId} />
      <button
        type="submit"
        className="inline-flex h-8 items-center rounded-sm border border-danger/40 px-3 text-[13px] text-danger hover:bg-danger/10"
      >
        {t("signOut")}
      </button>
    </form>
  );
}
