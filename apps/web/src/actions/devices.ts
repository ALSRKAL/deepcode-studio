"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { devices } from "@deepcode/db";
import { db } from "@/lib/db";
import { revokeKeysForDevice } from "@/lib/apiKeys";
import { invalidateGateway } from "@/lib/gateway";
import { requireUser } from "@/lib/guards";

/** Devices page: "Sign out device" revokes its key (docs/plan/03 §5). */
export async function revokeDeviceAction(formData: FormData): Promise<void> {
  const deviceId = z.string().uuid().safeParse(formData.get("deviceId"));
  if (!deviceId.success) return;
  const user = await requireUser();

  await db().db.transaction(async (tx) => {
    const [device] = await tx
      .select()
      .from(devices)
      .where(eq(devices.id, deviceId.data));
    if (!device || device.userId !== user.id) return;
    const hashes = await revokeKeysForDevice(tx, user.id, device.id);
    await tx.delete(devices).where(eq(devices.id, device.id));
    if (hashes.length > 0) {
      await invalidateGateway({ keyHashes: hashes });
    }
  });
  revalidatePath("/dashboard/devices");
}
