import { createAdminClient } from "@/lib/supabase/admin";
import { CommandError, parseCommandBody, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "invoice-create-manual",
  "invoice-create-sale",
  "credit-note-create",
  "delivery-note-create",
  "document-note-add",
]);

type Body = Record<string, unknown> & { workspaceId?: unknown; action?: unknown };

function uuid(value: unknown, field: string, nullable = false) {
  const result = String(value ?? "").trim();
  if (!result && nullable) return null;
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) throw new CommandError("INVALID_ACCOUNTS_INPUT", "A business document field is too long.");
  return result;
}

function requiredText(value: unknown, field: string, minimum: number, maximum: number) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  return result;
}

function dateValue(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  const result = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T00:00:00Z`).getTime())) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  }
  return result;
}

function lines(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} must contain between 1 and 100 lines.`);
  }
  return value;
}

function adminClient() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}

function friendly(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied")) return new CommandError("ACCOUNTS_FORBIDDEN", "You do not have permission to perform this Accounts action.", 403);
  if (message.includes("not found") || message.includes("unavailable")) return new CommandError("ACCOUNTS_NOT_FOUND", error.message, 404);
  if (message.includes("exceeds") || message.includes("issued") || message.includes("cancelled") || message.includes("immutable") || error.code === "23505") {
    return new CommandError("ACCOUNTS_STATE_CONFLICT", error.message, 409);
  }
  return new CommandError("ACCOUNTS_COMMAND_FAILED", error.message, 400);
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<Body>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace") as string;
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) throw new CommandError("INVALID_ACCOUNTS_ACTION", "Final document action is invalid.");

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for financial changes.");
    const admin = adminClient();
    let result: { data: unknown; error: { message: string; code?: string | null } | null };

    if (action === "invoice-create-manual" || action === "invoice-create-sale") {
      result = await admin.rpc("create_and_issue_invoice_command", {
        p_workspace_id: workspaceId,
        p_invoice_id: uuid(body.id, "Invoice ID"),
        p_source: action === "invoice-create-sale" ? "sale" : "manual",
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_source_sale_id: action === "invoice-create-sale" ? uuid(body.sourceSaleId, "Sale") : null,
        p_customer_id: action === "invoice-create-manual" ? uuid(body.customerId, "Customer") : null,
        p_due_at: dateValue(body.dueAt, "Due date"),
        p_description: body.description === undefined ? null : optionalText(body.description, 500),
        p_notes: body.notes === undefined ? null : optionalText(body.notes, 2000),
        p_lines: action === "invoice-create-manual" ? lines(body.lines, "Invoice") : [],
      });
    } else if (action === "credit-note-create") {
      result = await admin.rpc("create_and_issue_credit_note_command", {
        p_workspace_id: workspaceId,
        p_credit_note_id: uuid(body.id, "Credit Note ID"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_invoice_id: uuid(body.invoiceId, "Invoice"),
        p_reason: requiredText(body.reason, "Credit Note reason", 5, 500),
        p_lines: lines(body.lines, "Credit Note"),
      });
    } else if (action === "delivery-note-create") {
      const sourceType = String(body.sourceType ?? "").trim();
      if (!["invoice", "sale", "manual"].includes(sourceType)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Delivery Note source is invalid.");
      result = await admin.rpc("create_and_issue_delivery_note_command", {
        p_workspace_id: workspaceId,
        p_delivery_note_id: uuid(body.id, "Delivery Note ID"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_source_type: sourceType,
        p_source_id: sourceType === "manual" ? null : uuid(body.sourceId, "Delivery Note source"),
        p_customer_id: sourceType === "manual" ? uuid(body.customerId, "Customer") : null,
        p_delivery_date: dateValue(body.deliveryDate, "Delivery date"),
        p_delivery_address: body.deliveryAddress === undefined ? null : optionalText(body.deliveryAddress, 1000),
        p_notes: body.notes === undefined ? null : optionalText(body.notes, 2000),
        p_lines: lines(body.lines, "Delivery Note"),
      });
    } else {
      const documentType = String(body.documentType ?? "").trim();
      if (!["invoice", "credit_note", "delivery_note"].includes(documentType)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Business document type is invalid.");
      result = await admin.rpc("add_business_document_note", {
        p_workspace_id: workspaceId,
        p_note_id: uuid(body.id, "Note ID"),
        p_document_type: documentType,
        p_document_id: uuid(body.documentId, "Document"),
        p_note: requiredText(body.note, "Note", 1, 2000),
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
      });
    }

    if (result.error) throw friendly(result.error);
    return result.data as Record<string, unknown>;
  });
}