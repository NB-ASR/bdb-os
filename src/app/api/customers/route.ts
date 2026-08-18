import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ACTIONS = new Set(["create", "update", "archive", "restore"]);

type CustomerCommandBody = {
  workspaceId?: unknown;
  action?: unknown;
  id?: unknown;
  expectedVersion?: unknown;
  code?: unknown;
  name?: unknown;
  company?: unknown;
  email?: unknown;
  phone?: unknown;
  address?: unknown;
  notes?: unknown;
  preferences?: unknown;
  allowDuplicate?: unknown;
  vatNumber?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_CUSTOMER_INPUT", `${field} is invalid.`);
  return result;
}

function text(value: unknown, field: string, minimum: number, maximum: number) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_CUSTOMER_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) throw new CommandError("INVALID_CUSTOMER_INPUT", "A Customer field is too long.");
  return result;
}

function optionalEmail(value: unknown) {
  const result = optionalText(value, 320);
  if (result && !EMAIL_PATTERN.test(result)) {
    throw new CommandError("INVALID_CUSTOMER_EMAIL", "Enter a valid email address.");
  }
  return result;
}

function expectedVersion(value: unknown) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new CommandError("INVALID_CUSTOMER_VERSION", "Refresh the Customer before changing it.");
  }
  return result;
}

function preferences(value: unknown) {
  if (value === null || value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new CommandError("INVALID_CUSTOMER_INPUT", "Customer preferences are invalid.");
  }
  return value as Record<string, unknown>;
}

function friendlyCustomerError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("potential duplicate customer")) {
    return new CommandError(
      "CUSTOMER_DUPLICATE_REVIEW",
      "A Customer with the same email or phone already exists. Review the existing record before saving another.",
      409,
    );
  }
  if (error.code === "23505" || message.includes("duplicate key")) {
    return new CommandError("CUSTOMER_DUPLICATE", "That Customer code is already used in this workspace.", 409);
  }
  if (message.includes("changed on another device")) {
    return new CommandError("CUSTOMER_CONFLICT", "This Customer changed on another device. Refresh before saving.", 409);
  }
  if (message.includes("access denied")) {
    return new CommandError("CUSTOMER_FORBIDDEN", "You do not have permission to change Customers.", 403);
  }
  if (message.includes("not found")) {
    return new CommandError("CUSTOMER_NOT_FOUND", "The Customer could not be found.", 404);
  }
  return new CommandError("CUSTOMER_COMMAND_FAILED", error.message, 400);
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);

    const { data, error } = await supabase
      .from("customers")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("status")
      .order("name");
    if (error) throw error;

    return { workspaceId, customers: data ?? [] };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<CustomerCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const customerId = uuid(body.id, "Customer ID");
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) throw new CommandError("INVALID_CUSTOMER_ACTION", "Customer action is invalid.");

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Customer changes.");
    }

    const values = action === "create" || action === "update"
      ? {
        code: optionalText(body.code, 64),
        name: text(body.name, "Customer name", 1, 160),
        company: optionalText(body.company, 160),
        email: optionalEmail(body.email),
        phone: optionalText(body.phone, 50),
        address: optionalText(body.address, 1000),
        notes: optionalText(body.notes, 4000),
        preferences: preferences(body.preferences),
        allowDuplicate: body.allowDuplicate === true,
        vatNumber: optionalText(body.vatNumber, 64),
      }
      : {
        code: null,
        name: null,
        company: null,
        email: null,
        phone: null,
        address: null,
        notes: null,
        preferences: {},
        allowDuplicate: false,
        vatNumber: null,
      };

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("apply_customer_command", {
      p_workspace_id: workspaceId,
      p_customer_id: customerId,
      p_action: action,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_expected_version: action === "create" ? null : expectedVersion(body.expectedVersion),
      p_code: values.code,
      p_name: values.name,
      p_company: values.company,
      p_email: values.email,
      p_phone: values.phone,
      p_address: values.address,
      p_notes: values.notes,
      p_preferences: values.preferences,
      p_allow_duplicate: values.allowDuplicate,
      p_vat_number: values.vatNumber,
    });
    if (error) throw friendlyCustomerError(error);

    return data as Record<string, unknown>;
  });
}
