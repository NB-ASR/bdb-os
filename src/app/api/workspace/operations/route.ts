import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";
import { hashJson } from "@/lib/server/workspace-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_OPERATIONS_INPUT", `${field} is invalid.`);
  }
  return result;
}

function requireAdmin() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}

async function getAccess(workspaceId: string) {
  const supabase = await createClient();
  if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  const result = await supabase.rpc("get_workspace_settings_access", {
    target_workspace_id: workspaceId,
  });
  if (result.error) throw result.error;
  const row = ((result.data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
  return {
    canView: Boolean(row.can_view),
    canManage: Boolean(row.can_manage),
    supportReadOnly: Boolean(row.support_read_only),
    restorableRecordCount: Number(row.restorable_record_count ?? 0),
  };
}

function databaseCommandError(error: { message?: string } | null, fallback: string): never {
  const text = String(error?.message ?? fallback);
  const forbidden = /not permitted|restricted to the owner/i.test(text);
  throw new CommandError(
    forbidden ? "OPERATIONS_FORBIDDEN" : "OPERATIONS_REJECTED",
    text,
    forbidden ? 403 : 409,
  );
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const context = await requireWorkspaceCommand(request, workspaceId);
    const access = await getAccess(workspaceId);
    if (!access.canView) {
      throw new CommandError("OPERATIONS_FORBIDDEN", "Operational settings are not available.", 403);
    }

    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [settingsResult, subscriptionResult, activityResult] = await Promise.all([
      supabase
        .from("workspace_operational_settings")
        .select("fiscal_year_start_month,default_export_format,archived_records_default,appointment_reminders_enabled,updated_at")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      supabase
        .from("push_subscriptions")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("user_id", context.userId),
      supabase
        .from("activity_items")
        .select("occurred_at")
        .eq("workspace_id", workspaceId)
        .order("occurred_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    for (const result of [settingsResult, subscriptionResult, activityResult]) {
      if (result.error) throw result.error;
    }

    const settings = (settingsResult.data ?? {}) as Record<string, unknown>;
    return {
      workspaceId,
      fiscalYearStartMonth: Number(settings.fiscal_year_start_month ?? 1),
      defaultExportFormat: String(settings.default_export_format ?? "csv"),
      archivedRecordsDefault: String(settings.archived_records_default ?? "hide"),
      appointmentRemindersEnabled: settings.appointment_reminders_enabled !== false,
      pushSubscriptionCount: Number(subscriptionResult.count ?? 0),
      access: {
        canManage: access.canManage,
        supportReadOnly: access.supportReadOnly,
      },
      system: {
        database: "available",
        lastWorkspaceActivityAt: activityResult.data?.occurred_at ?? null,
        structuredOperationalRecordCount: access.restorableRecordCount,
      },
      updatedAt: settings.updated_at ? String(settings.updated_at) : null,
      generatedAt: new Date().toISOString(),
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<Record<string, unknown>>(request);
    if (body.action !== "update_operations") {
      throw new CommandError("INVALID_OPERATIONS_ACTION", "The operational settings action is invalid.", 400);
    }

    const workspaceId = uuid(body.workspaceId, "Workspace");
    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required.", 400);
    }

    const payload = {
      fiscalYearStartMonth: Number(body.fiscalYearStartMonth),
      defaultExportFormat: String(body.defaultExportFormat ?? ""),
      archivedRecordsDefault: String(body.archivedRecordsDefault ?? ""),
      appointmentRemindersEnabled: body.appointmentRemindersEnabled !== false,
    };
    const requestHash = hashJson({ action: body.action, workspaceId, payload });
    const admin = requireAdmin();
    const result = await admin.rpc("update_workspace_operational_settings", {
      target_workspace_id: workspaceId,
      target_actor_user_id: context.userId,
      target_idempotency_key: context.idempotencyKey,
      target_request_hash: requestHash,
      target_fiscal_year_start_month: payload.fiscalYearStartMonth,
      target_default_export_format: payload.defaultExportFormat,
      target_archived_records_default: payload.archivedRecordsDefault,
      target_appointment_reminders_enabled: payload.appointmentRemindersEnabled,
      target_command_id: context.commandId,
      target_occurred_at: new Date().toISOString(),
    });
    if (result.error) databaseCommandError(result.error, "Operational settings could not be saved.");
    return result.data;
  });
}
