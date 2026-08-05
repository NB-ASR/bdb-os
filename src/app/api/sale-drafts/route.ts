import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["create", "update", "discard", "restore", "complete"]);

type SaleDraftBody = Record<string, unknown> & {
  workspaceId?: unknown;
  action?: unknown;
  id?: unknown;
  expectedVersion?: unknown;
  appointmentId?: unknown;
  saleId?: unknown;
  unitPrice?: unknown;
  discountAmount?: unknown;
  occurredAt?: unknown;
  notes?: unknown;
  reason?: unknown;
};

function uuid(value: unknown, field: string, optional = false) {
  const result = String(value ?? "").trim();
  if (!result && optional) return null;
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_APPOINTMENT_SALE_DRAFT", `${field} is invalid.`);
  }
  return result;
}

function version(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new CommandError("INVALID_APPOINTMENT_SALE_DRAFT", "Refresh this draft before changing it.");
  }
  return result;
}

function money(value: unknown, field: string, optional = false) {
  if ((value === null || value === undefined || value === "") && optional) return null;
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > 1000000000) {
    throw new CommandError("INVALID_APPOINTMENT_SALE_DRAFT", `${field} is invalid.`);
  }
  return result;
}

function timestamp(value: unknown, optional = false) {
  const result = String(value ?? "").trim();
  if (!result && optional) return null;
  const date = new Date(result);
  if (!result || Number.isNaN(date.getTime())) {
    throw new CommandError("INVALID_APPOINTMENT_SALE_DRAFT", "Sale date and time are invalid.");
  }
  return date.toISOString();
}

function text(value: unknown, maximum: number, optional = true) {
  const result = String(value ?? "").trim();
  if (!result && optional) return null;
  if (!result || result.length > maximum) {
    throw new CommandError("INVALID_APPOINTMENT_SALE_DRAFT", "An Appointment Sale draft field is invalid.");
  }
  return result;
}

function friendlyError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("changed on another device")) {
    return new CommandError("APPOINTMENT_SALE_DRAFT_VERSION_CONFLICT", error.message, 409);
  }
  if (message.includes("only completed appointments")) {
    return new CommandError("APPOINTMENT_NOT_COMPLETED", "Complete the Appointment before creating its Sale draft.", 409);
  }
  if (message.includes("only open") || message.includes("only discarded")) {
    return new CommandError("APPOINTMENT_SALE_DRAFT_STATUS_CONFLICT", error.message, 409);
  }
  if (message.includes("discount")) {
    return new CommandError("APPOINTMENT_SALE_DRAFT_DISCOUNT_INVALID", error.message, 400);
  }
  if (message.includes("price") || message.includes("date and time")) {
    return new CommandError("APPOINTMENT_SALE_DRAFT_REVIEW_REQUIRED", error.message, 409);
  }
  if (message.includes("access denied")) {
    return new CommandError("APPOINTMENT_SALE_DRAFT_FORBIDDEN", "You do not have permission to manage Appointment Sale drafts.", 403);
  }
  if (message.includes("not found") || message.includes("required")) {
    return new CommandError("APPOINTMENT_SALE_DRAFT_REFERENCE_INVALID", error.message, 409);
  }
  if (error.code === "23505" || message.includes("duplicate key") || message.includes("identity conflict")) {
    return new CommandError("APPOINTMENT_SALE_DRAFT_DUPLICATE", "This Appointment draft or Sale was already recorded.", 409);
  }
  return new CommandError("APPOINTMENT_SALE_DRAFT_FAILED", error.message, 400);
}

async function requireSalesRead(request: Request, workspaceId: string) {
  const context = await requireWorkspaceCommand(request, workspaceId);
  if (context.isSupportSession) return context;

  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) {
    throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  }

  const featureResult = await supabase.rpc("get_effective_features", { target_workspace_id: workspaceId });
  if (featureResult.error) throw featureResult.error;
  const salesEnabled = ((featureResult.data ?? []) as Array<{ feature_key: string; enabled: boolean }>)
    .some((feature) => feature.feature_key === "sales" && feature.enabled);
  if (!salesEnabled) {
    throw new CommandError("APPOINTMENT_SALE_DRAFT_FORBIDDEN", "Sales is not enabled for this workspace.", 403);
  }

  if (context.accessProfile === "custom") {
    const { data, error } = await admin
      .from("workspace_member_permissions")
      .select("can_view")
      .eq("workspace_id", workspaceId)
      .eq("user_id", context.userId)
      .eq("feature_key", "sales")
      .maybeSingle();
    if (error) throw error;
    if (!data?.can_view) {
      throw new CommandError("APPOINTMENT_SALE_DRAFT_FORBIDDEN", "You do not have permission to view Sales.", 403);
    }
  }

  return context;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace") as string;
    const context = await requireSalesRead(request, workspaceId);
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [draftsResult, appointmentsResult, permissionResult] = await Promise.all([
      admin
        .from("sale_drafts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("occurred_at", { ascending: false }),
      admin
        .from("bookings")
        .select("id,reference,customer_id,customer_name_snapshot,service_id,service_code_snapshot,title,price_snapshot,vat_rate_snapshot,completed_at,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "completed")
        .not("service_id", "is", null)
        .order("completed_at", { ascending: false }),
      context.accessProfile === "custom"
        ? admin
          .from("workspace_member_permissions")
          .select("can_create")
          .eq("workspace_id", workspaceId)
          .eq("user_id", context.userId)
          .eq("feature_key", "sales")
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const failed = [draftsResult, appointmentsResult, permissionResult].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const canManage = context.accessMode === "support_test_write"
      || context.accessProfile === "owner"
      || context.accessProfile === "manager"
      || context.accessProfile === "employee"
      || (context.accessProfile === "custom" && Boolean(permissionResult.data?.can_create));

    return {
      workspaceId,
      canManage,
      drafts: draftsResult.data ?? [],
      completedAppointments: appointmentsResult.data ?? [],
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<SaleDraftBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace") as string;
    const draftId = uuid(body.id, "Draft ID") as string;
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) {
      throw new CommandError("INVALID_APPOINTMENT_SALE_DRAFT", "Appointment Sale draft action is invalid.");
    }

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Appointment Sale draft changes.");
    }

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("apply_appointment_sale_draft_command", {
      p_workspace_id: workspaceId,
      p_draft_id: draftId,
      p_action: action,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_expected_version: version(body.expectedVersion),
      p_appointment_id: uuid(body.appointmentId, "Appointment", true),
      p_sale_id: uuid(body.saleId, "Sale ID", true),
      p_unit_price: money(body.unitPrice, "Unit price", true),
      p_discount_amount: money(body.discountAmount ?? 0, "Discount"),
      p_occurred_at: timestamp(body.occurredAt, true),
      p_notes: text(body.notes, 1000),
      p_reason: text(body.reason, 500),
    });
    if (error) throw friendlyError(error);

    return data as Record<string, unknown>;
  });
}
