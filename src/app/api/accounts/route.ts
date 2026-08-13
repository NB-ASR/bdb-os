import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "invoice-create-manual",
  "invoice-create-sale",
  "invoice-update",
  "invoice-issue",
  "invoice-void",
  "payment-record",
  "payment-allocate",
  "allocation-reverse",
  "payment-reverse",
]);
const PAYMENT_METHODS = new Set(["cash", "card", "bank_transfer", "cheque", "other"]);

type AccountsCommandBody = Record<string, unknown> & {
  workspaceId?: unknown;
  action?: unknown;
};

type ManualLineInput = {
  id?: unknown;
  code?: unknown;
  description?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  discountAmount?: unknown;
  vatRate?: unknown;
};

type AllocationInput = {
  id?: unknown;
  invoiceId?: unknown;
  amount?: unknown;
};

function uuid(value: unknown, field: string, nullable = false) {
  const result = String(value ?? "").trim();
  if (!result && nullable) return null;
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  }
  return result;
}

function text(value: unknown, field: string, minimum = 1, maximum = 500) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", "A financial field is too long.");
  }
  return result;
}

function numberValue(
  value: unknown,
  field: string,
  options: { minimum?: number; maximum?: number; positive?: boolean } = {},
) {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} must be a number.`);
  }
  if (options.positive && result <= 0) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} must be greater than zero.`);
  }
  if (options.minimum !== undefined && result < options.minimum) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is below the allowed minimum.`);
  }
  if (options.maximum !== undefined && result > options.maximum) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} exceeds the allowed maximum.`);
  }
  return result;
}

function version(value: unknown) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", "Expected version is invalid.");
  }
  return result;
}

function dateValue(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T00:00:00Z`).getTime())) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  }
  return result;
}

function timestamp(value: unknown, field: string) {
  const raw = String(value ?? "").trim();
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  }
  return parsed.toISOString();
}

function manualLines(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new CommandError("INVALID_INVOICE_LINES", "An Invoice must contain between 1 and 100 lines.");
  }
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new CommandError("INVALID_INVOICE_LINES", `Invoice line ${index + 1} is invalid.`);
    }
    const line = raw as ManualLineInput;
    const id = uuid(line.id, `Invoice line ${index + 1} ID`) as string;
    if (ids.has(id)) throw new CommandError("INVALID_INVOICE_LINES", "Invoice line IDs must be unique.");
    ids.add(id);
    return {
      id,
      code: optionalText(line.code, 64),
      description: text(line.description, `Invoice line ${index + 1} description`, 1, 240),
      quantity: numberValue(line.quantity, `Invoice line ${index + 1} quantity`, { positive: true, maximum: 100000 }),
      unitPrice: numberValue(line.unitPrice, `Invoice line ${index + 1} price`, { minimum: 0 }),
      discountAmount: numberValue(line.discountAmount ?? 0, `Invoice line ${index + 1} discount`, { minimum: 0 }),
      vatRate: numberValue(line.vatRate ?? 0, `Invoice line ${index + 1} VAT rate`, { minimum: 0, maximum: 100 }),
    };
  });
}

function paymentAllocations(value: unknown) {
  if (value === null || value === undefined || value === "") return [];
  if (!Array.isArray(value) || value.length > 100) {
    throw new CommandError("INVALID_PAYMENT_ALLOCATIONS", "Payment allocations are invalid.");
  }
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new CommandError("INVALID_PAYMENT_ALLOCATIONS", `Allocation ${index + 1} is invalid.`);
    }
    const allocation = raw as AllocationInput;
    const id = uuid(allocation.id, `Allocation ${index + 1} ID`) as string;
    if (ids.has(id)) throw new CommandError("INVALID_PAYMENT_ALLOCATIONS", "Allocation IDs must be unique.");
    ids.add(id);
    return {
      id,
      invoiceId: uuid(allocation.invoiceId, `Allocation ${index + 1} Invoice`) as string,
      amount: numberValue(allocation.amount, `Allocation ${index + 1} amount`, { positive: true }),
    };
  });
}

function friendlyAccountsError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied")) {
    return new CommandError("ACCOUNTS_FORBIDDEN", "You do not have permission to perform this financial action.", 403);
  }
  if (message.includes("changed on another device")) {
    return new CommandError("ACCOUNTS_VERSION_CONFLICT", error.message, 409);
  }
  if (
    message.includes("already has an active invoice")
    || message.includes("already been reversed")
    || message.includes("exceeds the")
    || message.includes("must belong to the same customer")
    || message.includes("currencies must match")
    || message.includes("reverse invoice payment allocations")
    || message.includes("reverse payment allocations")
    || message.includes("unavailable")
    || message.includes("immutable")
    || error.code === "23505"
  ) {
    return new CommandError("ACCOUNTS_STATE_CONFLICT", error.message, 409);
  }
  if (message.includes("not found")) {
    return new CommandError("ACCOUNTS_NOT_FOUND", error.message, 404);
  }
  return new CommandError("ACCOUNTS_COMMAND_FAILED", error.message, 400);
}

function adminClient() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace") as string;
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [
      invoicesResult,
      invoiceBalancesResult,
      paymentsResult,
      allocationsResult,
      customerBalancesResult,
      customersResult,
      saleStatusResult,
      settingsResult,
    ] = await Promise.all([
      supabase
        .from("invoices")
        .select("*,invoice_lines(*)")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      supabase
        .from("invoice_account_balances")
        .select("*")
        .eq("workspace_id", workspaceId),
      supabase
        .from("payment_account_balances")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("received_at", { ascending: false }),
      supabase
        .from("payment_allocations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("occurred_at", { ascending: false }),
      supabase
        .from("customer_account_balances")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("customer_name"),
      supabase
        .from("customers")
        .select("id,code,name,company,email,phone,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name"),
      supabase
        .from("sale_account_status")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("sale_reference"),
      supabase
        .from("workspace_settings")
        .select("currency,invoice_prefix,vat_rate,timezone")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

    const failed = [
      invoicesResult,
      invoiceBalancesResult,
      paymentsResult,
      allocationsResult,
      customerBalancesResult,
      customersResult,
      saleStatusResult,
      settingsResult,
    ].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const balanceMap = new Map(
      (invoiceBalancesResult.data ?? []).map((invoice) => [invoice.id, invoice]),
    );
    const invoices = (invoicesResult.data ?? []).map((invoice) => ({
      ...invoice,
      ...(balanceMap.get(invoice.id) ?? {}),
      invoice_lines: [...(invoice.invoice_lines ?? [])].sort(
        (a, b) => Number(a.line_number) - Number(b.line_number),
      ),
    }));

    return {
      workspaceId,
      settings: settingsResult.data ?? { currency: "EUR", invoice_prefix: "INV", vat_rate: 0, timezone: "UTC" },
      invoices,
      payments: paymentsResult.data ?? [],
      allocations: allocationsResult.data ?? [],
      customerBalances: customerBalancesResult.data ?? [],
      customers: customersResult.data ?? [],
      sales: saleStatusResult.data ?? [],
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<AccountsCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace") as string;
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) {
      throw new CommandError("INVALID_ACCOUNTS_ACTION", "Accounts action is invalid.");
    }
    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for financial changes.");
    }
    const admin = adminClient();

    let result: { data: unknown; error: { message: string; code?: string | null } | null };

    if (action.startsWith("invoice-")) {
      const invoiceAction = action === "invoice-create-manual"
        ? "create_manual"
        : action === "invoice-create-sale"
          ? "create_from_sale"
          : action.replace("invoice-", "");
      result = await admin.rpc("apply_invoice_command", {
        p_workspace_id: workspaceId,
        p_invoice_id: uuid(body.id, "Invoice ID"),
        p_action: invoiceAction,
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_expected_version: ["update", "issue", "void"].includes(invoiceAction)
          ? version(body.expectedVersion)
          : null,
        p_source_sale_id: action === "invoice-create-sale" ? uuid(body.saleId, "Sale") : null,
        p_customer_id: action === "invoice-create-manual" ? uuid(body.customerId, "Customer") : null,
        p_due_at: ["invoice-create-manual", "invoice-create-sale", "invoice-update"].includes(action) && body.dueAt
          ? dateValue(body.dueAt, "Due date")
          : null,
        p_description: ["invoice-create-manual", "invoice-update"].includes(action) && body.description !== undefined
          ? text(body.description, "Invoice description", 1, 500)
          : optionalText(body.description, 500),
        p_notes: body.notes === undefined ? null : optionalText(body.notes, 2000),
        p_lines: ["invoice-create-manual", "invoice-update"].includes(action) && body.lines !== undefined
          ? manualLines(body.lines)
          : [],
        p_reason: action === "invoice-void" ? text(body.reason, "Void reason", 5, 500) : null,
      });
    } else if (action === "payment-record") {
      const method = String(body.paymentMethod ?? "").trim();
      if (!PAYMENT_METHODS.has(method)) {
        throw new CommandError("INVALID_ACCOUNTS_INPUT", "Payment method is invalid.");
      }
      result = await admin.rpc("record_payment", {
        p_workspace_id: workspaceId,
        p_payment_id: uuid(body.id, "Payment ID"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_customer_id: uuid(body.customerId, "Customer"),
        p_amount: numberValue(body.amount, "Payment amount", { positive: true }),
        p_payment_method: method,
        p_received_at: timestamp(body.receivedAt, "Payment date"),
        p_external_reference: optionalText(body.externalReference, 160),
        p_notes: optionalText(body.notes, 2000),
        p_allocations: paymentAllocations(body.allocations),
      });
    } else if (action === "payment-allocate") {
      result = await admin.rpc("allocate_payment", {
        p_workspace_id: workspaceId,
        p_allocation_id: uuid(body.id, "Allocation ID"),
        p_payment_id: uuid(body.paymentId, "Payment"),
        p_invoice_id: uuid(body.invoiceId, "Invoice"),
        p_amount: numberValue(body.amount, "Allocation amount", { positive: true }),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_occurred_at: body.occurredAt ? timestamp(body.occurredAt, "Allocation date") : new Date().toISOString(),
      });
    } else if (action === "allocation-reverse") {
      result = await admin.rpc("reverse_payment_allocation", {
        p_workspace_id: workspaceId,
        p_reversal_id: uuid(body.id, "Reversal ID"),
        p_allocation_id: uuid(body.allocationId, "Allocation"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_reason: text(body.reason, "Reversal reason", 5, 500),
        p_occurred_at: body.occurredAt ? timestamp(body.occurredAt, "Reversal date") : new Date().toISOString(),
      });
    } else {
      result = await admin.rpc("reverse_payment", {
        p_workspace_id: workspaceId,
        p_payment_id: uuid(body.paymentId ?? body.id, "Payment"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_reason: text(body.reason, "Reversal reason", 5, 500),
      });
    }

    if (result.error) throw friendlyAccountsError(result.error);
    return result.data as Record<string, unknown>;
  });
}
