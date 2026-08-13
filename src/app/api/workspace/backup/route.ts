import { createAdminClient } from "@/lib/supabase/admin";
import {
  CommandError,
  commandJson,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";
import {
  addSnapshotChecksum,
  hashJson,
  verifySnapshotEnvelope,
  type WorkspaceSnapshot,
} from "@/lib/server/workspace-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SNAPSHOT_BYTES = 15_000_000;

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_SNAPSHOT_INPUT", `${field} is invalid.`);
  }
  return result;
}

function requireAdmin() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "workspace";
}

function databaseCommandError(error: { message?: string } | null, fallback: string): never {
  const message = String(error?.message ?? fallback);
  const forbidden = /restricted to the owner|not permitted/i.test(message);
  throw new CommandError(
    forbidden ? "SNAPSHOT_FORBIDDEN" : "SNAPSHOT_REJECTED",
    message,
    forbidden ? 403 : 409,
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const context = await requireWorkspaceCommand(request, workspaceId);
    const admin = requireAdmin();

    const result = await admin.rpc("export_workspace_snapshot", {
      target_workspace_id: workspaceId,
      target_actor_user_id: context.userId,
      target_exported_at: new Date().toISOString(),
    });
    if (result.error) databaseCommandError(result.error, "Workspace snapshot could not be created.");

    const envelope = addSnapshotChecksum(result.data as WorkspaceSnapshot);
    const filename = `${safeFilename(envelope.workspace.name)}-${new Date(envelope.exportedAt)
      .toISOString()
      .slice(0, 10)}.bdb-snapshot.json`;

    return new Response(`${JSON.stringify(envelope, null, 2)}\n`, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    if (error instanceof CommandError) {
      return commandJson(
        { ok: false, error: error.message, code: error.code },
        { status: error.status },
      );
    }
    console.error("BDB OS snapshot export failed", error);
    return commandJson(
      { ok: false, error: "Workspace snapshot could not be created.", code: "SNAPSHOT_FAILED" },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const form = await request.formData();
    const workspaceId = uuid(form.get("workspaceId"), "Workspace");
    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required.", 400);
    }

    const file = form.get("file");
    if (!(file instanceof File)) {
      throw new CommandError("SNAPSHOT_REQUIRED", "Choose a BDB OS snapshot file.", 400);
    }
    if (file.size <= 0 || file.size > MAX_SNAPSHOT_BYTES) {
      throw new CommandError(
        "INVALID_SNAPSHOT_SIZE",
        "Workspace snapshots must be no larger than 15 MB.",
        400,
      );
    }

    const raw = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw) as unknown;
    } catch {
      throw new CommandError(
        "INVALID_SNAPSHOT_JSON",
        "The selected file is not valid JSON.",
        400,
      );
    }
    const snapshot = verifySnapshotEnvelope(parsed, workspaceId);
    const admin = requireAdmin();

    const workspaceResult = await admin
      .from("workspaces")
      .select("name")
      .eq("id", workspaceId)
      .maybeSingle();
    if (workspaceResult.error) throw workspaceResult.error;
    if (!workspaceResult.data) {
      throw new CommandError("SNAPSHOT_WORKSPACE_MISSING", "The workspace no longer exists.", 404);
    }

    const requiredConfirmation = `RESTORE ${workspaceResult.data.name}`;
    if (String(form.get("confirmation") ?? "") !== requiredConfirmation) {
      throw new CommandError(
        "RESTORE_CONFIRMATION_REQUIRED",
        `Type ${requiredConfirmation} exactly before restoring.`,
        400,
      );
    }

    const requestHash = hashJson(snapshot);
    const result = await admin.rpc("restore_workspace_snapshot", {
      target_workspace_id: workspaceId,
      target_actor_user_id: context.userId,
      target_idempotency_key: context.idempotencyKey,
      target_request_hash: requestHash,
      target_snapshot: snapshot,
      target_command_id: context.commandId,
      target_occurred_at: new Date().toISOString(),
    });
    if (result.error) databaseCommandError(result.error, "Workspace snapshot could not be restored.");
    return result.data;
  });
}
