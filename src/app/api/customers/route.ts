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
const CUSTOMER_FILTERS = new Set(["active", "archived", "imported", "all"]);
const DEFAULT_PAGE_SIZE = 100;
const MAX_PAGE_SIZE = 100;

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
  preferences?: unknown;
  allowDuplicate?: unknown;
  vatNumber?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_CUSTOMER_INPUT", `${field} is invalid.`);
  return result;
}

function optionalUuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!result) return null;
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

function pageSize(value: string | null) {
  if (!value) return DEFAULT_PAGE_SIZE;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new CommandError("INVALID_CUSTOMER_PAGE", "Customer page size is invalid.");
  }
  return Math.min(result, MAX_PAGE_SIZE);
}

function customerFilter(value: string | null) {
  const result = String(value ?? "active").trim();
  if (!CUSTOMER_FILTERS.has(result)) {
    throw new CommandError("INVALID_CUSTOMER_FILTER", "Customer filter is invalid.");
  }
  return result;
}

function searchText(value: string | null) {
  const result = String(value ?? "").trim();
  if (result.length > 120) throw new CommandError("INVALID_CUSTOMER_SEARCH", "Customer search is too long.");
  return result || null;
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
  if (message.includes("idempotency key was reused")) {
    return new CommandError(
      "CUSTOMER_IDEMPOTENCY_CONFLICT",
      "This Customer retry key was already used for different input. Refresh before retrying.",
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
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const limit = pageSize(url.searchParams.get("limit"));
    const filter = customerFilter(url.searchParams.get("filter"));
    const search = searchText(url.searchParams.get("search"));
    const afterName = optionalText(url.searchParams.get("afterName"), 160);
    const afterId = optionalUuid(url.searchParams.get("afterId"), "Customer cursor");
    if (Boolean(afterName) !== Boolean(afterId)) {
      throw new CommandError("INVALID_CUSTOMER_CURSOR", "Customer cursor is incomplete.");
    }

    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);

    const { data, error } = await supabase.rpc("list_customer_register_page", {
      p_workspace_id: workspaceId,
      p_limit: limit,
      p_after_name: afterName,
      p_after_id: afterId,
      p_search: search,
      p_filter: filter,
    });
    if (error) throw error;

    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const customers = rows.slice(0, limit);
    const hasMore = rows.length > limit;
    const tail = customers.at(-1);
    const nextCursor = hasMore && tail
      ? { name: String(tail.name ?? ""), id: String(tail.id ?? "") }
      : null;

    let summary: Record<string, number> | null = null;
    if (url.searchParams.get("summary") === "1") {
      const { data: summaryRows, error: summaryError } = await supabase.rpc("customer_register_summary", {
        p_workspace_id: workspaceId,
      });
      if (summaryError) throw summaryError;
      const value = Array.isArray(summaryRows) ? summaryRows[0] : summaryRows;
      summary = value ? {
        activeCount: Number(value.active_count ?? 0),
        archivedCount: Number(value.archived_count ?? 0),
        importedCount: Number(value.imported_count ?? 0),
        companyCount: Number(value.company_count ?? 0),
      } : { activeCount: 0, archivedCount: 0, importedCount: 0, companyCount: 0 };
    }

    return {
      workspaceId,
      customers,
      page: { limit, hasMore, nextCursor },
      summary,
    };
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
        preferences: {},
        allowDuplicate: false,
        vatNumber: null,
      };

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("execute_customer_command", {
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
      p_notes: null,
      p_preferences: values.preferences,
      p_allow_duplicate: values.allowDuplicate,
      p_vat_number: values.vatNumber,
    });
    if (error) throw friendlyCustomerError(error);

    return data as Record<string, unknown>;
  });
}
