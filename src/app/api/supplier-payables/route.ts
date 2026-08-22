import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";
import { readSupplierPayablesView } from "@/lib/server/supplier-payables-registers";
import { hashJson } from "@/lib/server/workspace-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "payable-post",
  "payable-reverse",
  "payment-record",
  "payment-allocate",
  "payment-allocation-reverse",
  "payment-reverse",
  "credit-allocate",
  "credit-allocation-reverse",
]);
const PAYMENT_METHODS = new Set(["cash", "card", "bank_transfer", "cheque", "other"]);

type SupplierPayablesBody = Record<string, unknown> & {
  workspaceId?: unknown;
  action?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", `${field} is invalid.`);
  }
  return result;
}

function text(value: unknown, field: string, minimum = 1, maximum = 500) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", "A Supplier financial field is too long.");
  }
  return result;
}

function amount(value: unknown, field: string) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", `${field} must be greater than zero.`);
  }
  return result;
}

function currency(value: unknown) {
  const result = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", "Currency is invalid.");
  }
  return result;
}

function timestamp(value: unknown, field: string) {
  const raw = String(value ?? "").trim();
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", `${field} is invalid.`);
  }
  return parsed.toISOString();
}

function friendlyError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied")) {
    return new CommandError("SUPPLIER_PAYABLES_FORBIDDEN", "You do not have permission to perform this Supplier Accounts action.", 403);
  }
  if (
    message.includes("already")
    || message.includes("exceeds")
    || message.includes("same supplier")
    || message.includes("currencies must match")
    || message.includes("reverse supplier")
    || message.includes("unavailable")
    || message.includes("only approved")
    || message.includes("only supplier")
    || message.includes("idempotency key was reused")
    || error.code === "23505"
  ) {
    return new CommandError("SUPPLIER_PAYABLES_STATE_CONFLICT", error.message, 409);
  }
  if (message.includes("not found")) {
    return new CommandError("SUPPLIER_PAYABLES_NOT_FOUND", error.message, 404);
  }
  return new CommandError("SUPPLIER_PAYABLES_COMMAND_FAILED", error.message, 400);
}

function adminClient() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    return readSupplierPayablesView(supabase, workspaceId, url);
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<SupplierPayablesBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) {
      throw new CommandError("INVALID_SUPPLIER_PAYABLES_ACTION", "Supplier Accounts action is invalid.");
    }

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Supplier financial changes.");
    }
    const admin = adminClient();
    const claim = await admin.rpc("claim_accounts_command", {
      p_workspace_id: workspaceId,
      p_idempotency_key: context.idempotencyKey,
      p_request_hash: hashJson({ workspaceId, action, body }),
    });
    if (claim.error) throw friendlyError(claim.error);

    let result: { data: unknown; error: { message: string; code?: string | null } | null };

    if (action === "payable-post") {
      result = await admin.rpc("post_supplier_document_payable", {
        p_workspace_id: workspaceId,
        p_payable_id: uuid(body.id, "Payable ID"),
        p_supplier_document_id: uuid(body.supplierDocumentId, "Supplier document"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
      });
    } else if (action === "payable-reverse") {
      result = await admin.rpc("reverse_supplier_payable", {
        p_workspace_id: workspaceId,
        p_payable_id: uuid(body.payableId, "Payable"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_reason: text(body.reason, "Reversal reason", 5, 500),
      });
    } else if (action === "payment-record") {
      const method = String(body.paymentMethod ?? "").trim();
      if (!PAYMENT_METHODS.has(method)) {
        throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", "Supplier Payment method is invalid.");
      }
      result = await admin.rpc("record_supplier_payment", {
        p_workspace_id: workspaceId,
        p_supplier_payment_id: uuid(body.id, "Supplier Payment ID"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_supplier_id: uuid(body.supplierId, "Supplier"),
        p_currency: currency(body.currency),
        p_amount: amount(body.amount, "Supplier Payment amount"),
        p_payment_method: method,
        p_paid_at: timestamp(body.paidAt, "Supplier Payment date"),
        p_external_reference: optionalText(body.externalReference, 160),
        p_notes: optionalText(body.notes, 2000),
      });
    } else if (action === "payment-allocate") {
      result = await admin.rpc("allocate_supplier_payment", {
        p_workspace_id: workspaceId,
        p_allocation_id: uuid(body.id, "Allocation ID"),
        p_supplier_payment_id: uuid(body.paymentId, "Supplier Payment"),
        p_supplier_payable_id: uuid(body.payableId, "Supplier payable"),
        p_amount: amount(body.amount, "Allocation amount"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_occurred_at: body.occurredAt ? timestamp(body.occurredAt, "Allocation date") : new Date().toISOString(),
      });
    } else if (action === "payment-allocation-reverse") {
      result = await admin.rpc("reverse_supplier_payment_allocation", {
        p_workspace_id: workspaceId,
        p_reversal_id: uuid(body.id, "Allocation reversal ID"),
        p_allocation_id: uuid(body.allocationId, "Supplier Payment allocation"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_reason: text(body.reason, "Reversal reason", 5, 500),
        p_occurred_at: body.occurredAt ? timestamp(body.occurredAt, "Reversal date") : new Date().toISOString(),
      });
    } else if (action === "payment-reverse") {
      result = await admin.rpc("reverse_supplier_payment", {
        p_workspace_id: workspaceId,
        p_supplier_payment_id: uuid(body.paymentId, "Supplier Payment"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_reason: text(body.reason, "Reversal reason", 5, 500),
      });
    } else if (action === "credit-allocate") {
      result = await admin.rpc("allocate_supplier_credit", {
        p_workspace_id: workspaceId,
        p_allocation_id: uuid(body.id, "Credit allocation ID"),
        p_credit_payable_id: uuid(body.creditPayableId, "Supplier credit"),
        p_invoice_payable_id: uuid(body.invoicePayableId, "Supplier invoice"),
        p_amount: amount(body.amount, "Credit allocation amount"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_occurred_at: body.occurredAt ? timestamp(body.occurredAt, "Credit allocation date") : new Date().toISOString(),
      });
    } else {
      result = await admin.rpc("reverse_supplier_credit_allocation", {
        p_workspace_id: workspaceId,
        p_reversal_id: uuid(body.id, "Credit allocation reversal ID"),
        p_allocation_id: uuid(body.allocationId, "Supplier credit allocation"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_reason: text(body.reason, "Reversal reason", 5, 500),
        p_occurred_at: body.occurredAt ? timestamp(body.occurredAt, "Credit allocation date") : new Date().toISOString(),
      });
    }

    if (result.error) throw friendlyError(result.error);
    return result.data as Record<string, unknown>;
  });
}
