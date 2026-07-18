import { createAdminClient } from "@/lib/supabase/admin";
import type { WorkspaceCommandContext } from "@/lib/server/command";

type ActivityTone = "gold" | "green" | "blue" | "neutral" | "red";

export type BusinessActivityInput = {
  action: string;
  detail: string;
  tone?: ActivityTone;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
};

export async function recordBusinessActivity(
  context: WorkspaceCommandContext,
  input: BusinessActivityInput,
) {
  const admin = createAdminClient();
  if (!admin) throw new Error("NOT_CONFIGURED");

  const { error } = await admin.from("activity_items").insert({
    workspace_id: context.workspaceId,
    actor_user_id: context.userId,
    action: input.action,
    detail: input.detail,
    tone: input.tone ?? "neutral",
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    command_id: context.commandId,
    metadata: {
      ...input.metadata,
      idempotency_key: context.idempotencyKey,
    },
  });
  if (error) throw error;
}

export async function recordSecurityAudit(input: {
  actorUserId?: string | null;
  workspaceId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}) {
  const admin = createAdminClient();
  if (!admin) throw new Error("NOT_CONFIGURED");

  const { error } = await admin.from("audit_logs").insert({
    actor_user_id: input.actorUserId ?? null,
    workspace_id: input.workspaceId ?? null,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) throw error;
}
