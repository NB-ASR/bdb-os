import { createAdminClient } from "@/lib/supabase/admin";
import { CommandError, parseCommandBody, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type CustomerImportBody = {
  workspaceId?: unknown;
  batchId?: unknown;
  sourceSnapshotId?: unknown;
  clients?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_CUSTOMER_IMPORT", `${field} is invalid.`);
  return result;
}

function parseSourceSnapshotId(value: unknown) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > 200) throw new CommandError("INVALID_CUSTOMER_IMPORT", "The source snapshot identifier is too long.");
  return result;
}

function parseClientRows(value: unknown) {
  if (!Array.isArray(value)) {
    throw new CommandError("INVALID_CUSTOMER_IMPORT", "The Vanita import must contain a clients array.");
  }
  if (value.length > 5000) {
    throw new CommandError("CUSTOMER_IMPORT_TOO_LARGE", "Import no more than 5000 Customers in one batch.");
  }
  return value;
}

function friendlyImportError(error: { message: string }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied")) {
    return new CommandError("CUSTOMER_IMPORT_FORBIDDEN", "You do not have permission to import Customers.", 403);
  }
  if (message.includes("idempotency")) {
    return new CommandError("CUSTOMER_IMPORT_CONFLICT", "This Customer import batch could not be reconciled safely.", 409);
  }
  return new CommandError("CUSTOMER_IMPORT_FAILED", error.message, 400);
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<CustomerImportBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const batchId = uuid(body.batchId, "Import batch");
    const clients = parseClientRows(body.clients);
    const snapshotId = parseSourceSnapshotId(body.sourceSnapshotId);

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Customer imports.");
    }

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("execute_vanita_customer_import", {
      p_workspace_id: workspaceId,
      p_batch_id: batchId,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_source_snapshot_id: snapshotId,
      p_clients: clients,
    });
    if (error) throw friendlyImportError(error);

    return data as Record<string, unknown>;
  });
}
