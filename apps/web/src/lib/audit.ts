import { auditLogs, type Database } from "@deepcode/db";

/** Admin mutations are recorded (docs/plan/03 §6). Actor and IP come from the action. */
export async function audit(
  db: Database,
  entry: {
    actorId: string | null;
    action: string;
    targetType: string;
    targetId?: string | null;
    metadata?: Record<string, unknown>;
    ip?: string | null;
  },
): Promise<void> {
  await db.insert(auditLogs).values({
    actorId: entry.actorId,
    action: entry.action,
    targetType: entry.targetType,
    targetId: entry.targetId ?? null,
    metadata: entry.metadata ?? null,
    ip: entry.ip ?? null,
  });
}
