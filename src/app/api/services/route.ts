import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["create", "update", "archive", "restore"]);
const BOOKING_MODES = new Set(["customer", "staff"]);

type ServiceCommandBody = Record<string, unknown> & {
  workspaceId?: unknown;
  action?: unknown;
  id?: unknown;
  expectedVersion?: unknown;
  code?: unknown;
  name?: unknown;
  category?: unknown;
  durationMinutes?: unknown;
  preparationBufferMinutes?: unknown;
  recoveryBufferMinutes?: unknown;
  price?: unknown;
  vatRate?: unknown;
  bookingMode?: unknown;
  description?: unknown;
  notes?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_SERVICE_INPUT", `${field} is invalid.`);
  return result;
}

function text(value: unknown, field: string, minimum: number, maximum: number) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_SERVICE_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) throw new CommandError("INVALID_SERVICE_INPUT", "A Service field is too long.");
  return result;
}

function integerValue(value: unknown, field: string, minimum: number, maximum: number) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < minimum || result > maximum) {
    throw new CommandError("INVALID_SERVICE_INPUT", `${field} is invalid.`);
  }
  return result;
}

function numberValue(value: unknown, field: string, maximum?: number) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (maximum !== undefined && result > maximum)) {
    throw new CommandError("INVALID_SERVICE_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalNumber(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return numberValue(value, field);
}

function expectedVersion(value: unknown) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new CommandError("INVALID_SERVICE_VERSION", "Refresh the Service before changing it.");
  }
  return result;
}

function friendlyServiceError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (error.code === "23505" || message.includes("duplicate key")) {
    return new CommandError("SERVICE_DUPLICATE", "That Service code is already used in this workspace.", 409);
  }
  if (message.includes("changed on another device")) {
    return new CommandError("SERVICE_CONFLICT", "This Service changed on another device. Refresh before saving.", 409);
  }
  if (message.includes("access denied")) {
    return new CommandError("SERVICE_FORBIDDEN", "You do not have permission to change Services.", 403);
  }
  if (message.includes("not found")) {
    return new CommandError("SERVICE_NOT_FOUND", "The Service could not be found.", 404);
  }
  return new CommandError("SERVICE_COMMAND_FAILED", error.message, 400);
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);

    const { data, error } = await supabase
      .from("services")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("status")
      .order("name");
    if (error) throw error;

    return { workspaceId, services: data ?? [] };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<ServiceCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const serviceId = uuid(body.id, "Service ID");
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) throw new CommandError("INVALID_SERVICE_ACTION", "Service action is invalid.");

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Service changes.");
    }

    const values = action === "create" || action === "update"
      ? {
        code: text(body.code, "Service code", 1, 64),
        name: text(body.name, "Service name", 2, 160),
        category: optionalText(body.category, 120),
        durationMinutes: integerValue(body.durationMinutes, "Duration", 5, 1440),
        preparationBufferMinutes: integerValue(body.preparationBufferMinutes ?? 0, "Preparation buffer", 0, 240),
        recoveryBufferMinutes: integerValue(body.recoveryBufferMinutes ?? 0, "Recovery buffer", 0, 240),
        price: optionalNumber(body.price, "Price"),
        vatRate: numberValue(body.vatRate ?? 0, "VAT rate", 100),
        bookingMode: String(body.bookingMode ?? "customer").trim(),
        description: optionalText(body.description, 2000),
        notes: optionalText(body.notes, 2000),
      }
      : {
        code: null,
        name: null,
        category: null,
        durationMinutes: null,
        preparationBufferMinutes: 0,
        recoveryBufferMinutes: 0,
        price: null,
        vatRate: 0,
        bookingMode: "customer",
        description: null,
        notes: null,
      };

    if (values.bookingMode !== null && !BOOKING_MODES.has(values.bookingMode)) {
      throw new CommandError("INVALID_SERVICE_INPUT", "Service booking mode is invalid.");
    }

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("apply_service_command", {
      p_workspace_id: workspaceId,
      p_service_id: serviceId,
      p_action: action,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_expected_version: action === "create" ? null : expectedVersion(body.expectedVersion),
      p_code: values.code,
      p_name: values.name,
      p_category: values.category,
      p_duration_minutes: values.durationMinutes,
      p_preparation_buffer_minutes: values.preparationBufferMinutes,
      p_recovery_buffer_minutes: values.recoveryBufferMinutes,
      p_price: values.price,
      p_vat_rate: values.vatRate,
      p_booking_mode: values.bookingMode,
      p_description: values.description,
      p_notes: values.notes,
    });
    if (error) throw friendlyServiceError(error);

    return data as Record<string, unknown>;
  });
}
