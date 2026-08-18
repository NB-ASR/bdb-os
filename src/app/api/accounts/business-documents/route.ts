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
  "invoice-create",
  "invoice-update",
  "invoice-issue",
  "invoice-void",
  "credit-note-create",
  "credit-note-update",
  "credit-note-issue",
  "credit-note-void",
  "delivery-note-create",
  "delivery-note-update",
  "delivery-note-issue",
  "delivery-note-void",
  "document-settings-update",
  "customer-vat-update",
]);

type Body = Record<string, unknown> & { workspaceId?: unknown; action?: unknown };

function uuid(value: unknown, field: string, nullable = false) {
  const result = String(value ?? "").trim();
  if (!result && nullable) return null;
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_BUSINESS_DOCUMENT_INPUT", `${field} is invalid.`);
  return result;
}

function text(value: unknown, field: string, minimum = 1, maximum = 500, nullable = false) {
  const result = String(value ?? "").trim();
  if (!result && nullable) return null;
  if (result.length < minimum || result.length > maximum) throw new CommandError("INVALID_BUSINESS_DOCUMENT_INPUT", `${field} is invalid.`);
  return result;
}

function numberValue(value: unknown, field: string, minimum?: number, maximum?: number) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new CommandError("INVALID_BUSINESS_DOCUMENT_INPUT", `${field} must be a number.`);
  if (minimum !== undefined && result < minimum) throw new CommandError("INVALID_BUSINESS_DOCUMENT_INPUT", `${field} is below the allowed minimum.`);
  if (maximum !== undefined && result > maximum) throw new CommandError("INVALID_BUSINESS_DOCUMENT_INPUT", `${field} exceeds the allowed maximum.`);
  return result;
}

function integer(value: unknown, field: string, minimum = 1) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < minimum) throw new CommandError("INVALID_BUSINESS_DOCUMENT_INPUT", `${field} is invalid.`);
  return result;
}

function dateValue(value: unknown, field: string, nullable = false) {
  const result = String(value ?? "").trim();
  if (!result && nullable) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T00:00:00Z`).getTime())) throw new CommandError("INVALID_BUSINESS_DOCUMENT_INPUT", `${field} is invalid.`);
  return result;
}

function invoiceLines(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new CommandError("INVALID_INVOICE_LINES", "An Invoice must contain between 1 and 100 lines.");
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CommandError("INVALID_INVOICE_LINES", `Invoice line ${index + 1} is invalid.`);
    const line = raw as Record<string, unknown>;
    return {
      id: uuid(line.id, `Invoice line ${index + 1} ID`),
      productId: uuid(line.productId, `Invoice line ${index + 1} Product`, true),
      serviceId: uuid(line.serviceId, `Invoice line ${index + 1} Service`, true),
      code: text(line.code, `Invoice line ${index + 1} code`, 1, 64, true),
      description: text(line.description, `Invoice line ${index + 1} description`, 1, 240, true),
      quantity: numberValue(line.quantity, `Invoice line ${index + 1} quantity`, 0.001, 100000),
      unitPrice: line.unitPrice === null || line.unitPrice === undefined || line.unitPrice === "" ? null : numberValue(line.unitPrice, `Invoice line ${index + 1} price`, 0),
      discountAmount: numberValue(line.discountAmount ?? 0, `Invoice line ${index + 1} discount`, 0),
      vatRate: line.vatRate === null || line.vatRate === undefined || line.vatRate === "" ? null : numberValue(line.vatRate, `Invoice line ${index + 1} VAT`, 0, 100),
    };
  });
}

function creditLines(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new CommandError("INVALID_CREDIT_NOTE_LINES", "A Credit Note must contain between 1 and 100 lines.");
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CommandError("INVALID_CREDIT_NOTE_LINES", `Credit line ${index + 1} is invalid.`);
    const line = raw as Record<string, unknown>;
    return { id: uuid(line.id, `Credit line ${index + 1} ID`), sourceInvoiceLineId: uuid(line.sourceInvoiceLineId, `Credit line ${index + 1} source`), quantity: numberValue(line.quantity, `Credit line ${index + 1} quantity`, 0.001, 100000) };
  });
}

function deliveryLines(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new CommandError("INVALID_DELIVERY_NOTE_LINES", "A Delivery Note must contain between 1 and 100 lines.");
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new CommandError("INVALID_DELIVERY_NOTE_LINES", `Delivery line ${index + 1} is invalid.`);
    const line = raw as Record<string, unknown>;
    return { id: uuid(line.id, `Delivery line ${index + 1} ID`), sourceLineId: uuid(line.sourceLineId, `Delivery line ${index + 1} source`), quantity: numberValue(line.quantity, `Delivery line ${index + 1} quantity`, 0.001, 100000) };
  });
}

function adminClient() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}

function friendly(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied")) return new CommandError("BUSINESS_DOCUMENT_FORBIDDEN", "You do not have permission for this document action.", 403);
  if (message.includes("not found") || message.includes("unavailable")) return new CommandError("BUSINESS_DOCUMENT_NOT_FOUND", error.message, 404);
  if (message.includes("changed on another device") || message.includes("immutable") || message.includes("exceeds") || message.includes("only a") || message.includes("required before") || error.code === "23505") return new CommandError("BUSINESS_DOCUMENT_CONFLICT", error.message, 409);
  return new CommandError("BUSINESS_DOCUMENT_FAILED", error.message, 400);
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace") as string;
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [indexResult, creditResult, deliveryResult, productsResult, servicesResult, settingsResult, workspaceResult] = await Promise.all([
      supabase.from("business_document_index").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(250),
      supabase.from("credit_notes").select("*,credit_note_lines(*)").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      supabase.from("delivery_notes").select("*,delivery_note_lines(*)").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      supabase.from("products").select("id,sku,name,selling_price,vat_rate,status").eq("workspace_id", workspaceId).eq("status", "active").order("name"),
      supabase.from("services").select("id,code,name,price,vat_rate,status").eq("workspace_id", workspaceId).eq("status", "active").order("name"),
      supabase.from("workspace_settings").select("business_address,vat_number,invoice_prefix,credit_note_prefix,delivery_note_prefix,default_payment_terms_days,currency,vat_rate").eq("workspace_id", workspaceId).maybeSingle(),
      supabase.from("workspaces").select("id,name,legal_name").eq("id", workspaceId).maybeSingle(),
    ]);
    const failed = [indexResult, creditResult, deliveryResult, productsResult, servicesResult, settingsResult, workspaceResult].find((result) => result.error);
    if (failed?.error) throw failed.error;

    return {
      workspaceId,
      documents: indexResult.data ?? [],
      creditNotes: (creditResult.data ?? []).map((row) => ({ ...row, credit_note_lines: [...(row.credit_note_lines ?? [])].sort((a, b) => Number(a.line_number) - Number(b.line_number)) })),
      deliveryNotes: (deliveryResult.data ?? []).map((row) => ({ ...row, delivery_note_lines: [...(row.delivery_note_lines ?? [])].sort((a, b) => Number(a.line_number) - Number(b.line_number)) })),
      products: productsResult.data ?? [],
      services: servicesResult.data ?? [],
      settings: settingsResult.data ?? {},
      workspace: workspaceResult.data ?? null,
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<Body>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace") as string;
    const action = String(body.action ?? "");
    if (!ACTIONS.has(action)) throw new CommandError("INVALID_BUSINESS_DOCUMENT_ACTION", "Business document action is invalid.");
    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required.");
    const admin = adminClient();

    if (action === "document-settings-update") {
      const result = await admin.rpc("update_business_document_settings", {
        p_workspace_id: workspaceId,
        p_actor_user_id: context.userId,
        p_business_address: text(body.businessAddress, "Business address", 1, 500),
        p_vat_number: text(body.vatNumber, "VAT number", 2, 40),
        p_credit_note_prefix: text(body.creditNotePrefix ?? "CN", "Credit Note prefix", 1, 8),
        p_delivery_note_prefix: text(body.deliveryNotePrefix ?? "DN", "Delivery Note prefix", 1, 8),
        p_default_payment_terms_days: integer(body.defaultPaymentTermsDays ?? 14, "Payment terms", 0),
        p_command_id: context.commandId,
      });
      if (result.error) throw friendly(result.error);
      return result.data as Record<string, unknown>;
    }

    if (action === "customer-vat-update") {
      const result = await admin.rpc("update_customer_vat_number", {
        p_workspace_id: workspaceId,
        p_customer_id: uuid(body.customerId, "Customer"),
        p_actor_user_id: context.userId,
        p_vat_number: text(body.vatNumber, "Customer VAT number", 2, 40, true),
        p_expected_version: integer(body.expectedVersion, "Customer version"),
        p_command_id: context.commandId,
      });
      if (result.error) throw friendly(result.error);
      return result.data as Record<string, unknown>;
    }

    if (action.startsWith("invoice-")) {
      const id = uuid(body.id, "Invoice") as string;
      const invoiceAction = action.replace("invoice-", "");
      const expected = body.expectedVersion === undefined || body.expectedVersion === null ? null : integer(body.expectedVersion, "Invoice version");
      const result = await admin.rpc("apply_invoice_command", {
        p_workspace_id: workspaceId,
        p_invoice_id: id,
        p_action: invoiceAction === "create" ? "create_manual" : invoiceAction,
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_expected_version: expected,
        p_source_sale_id: null,
        p_customer_id: invoiceAction === "create" ? uuid(body.customerId, "Customer") : null,
        p_due_at: ["create", "update"].includes(invoiceAction) ? dateValue(body.dueAt, "Due date") : null,
        p_description: ["create", "update"].includes(invoiceAction) ? text(body.description ?? "Invoice", "Description", 1, 500) : null,
        p_notes: text(body.notes, "Notes", 1, 2000, true),
        p_lines: ["create", "update"].includes(invoiceAction) ? invoiceLines(body.lines) : [],
        p_reason: invoiceAction === "void" ? text(body.reason, "Void reason", 5, 500) : null,
      });
      if (result.error) throw friendly(result.error);

      if (["create", "update"].includes(invoiceAction)) {
        const metadataVersion = invoiceAction === "create" ? 1 : (expected as number) + 1;
        const metadata = await admin.rpc("apply_invoice_document_metadata", {
          p_workspace_id: workspaceId,
          p_invoice_id: id,
          p_idempotency_key: `${context.idempotencyKey}:meta`.slice(0, 128),
          p_actor_user_id: context.userId,
          p_command_id: context.commandId,
          p_expected_version: metadataVersion,
          p_supply_date: dateValue(body.supplyDate ?? new Date().toISOString().slice(0, 10), "Supply date"),
          p_vat_note: text(body.vatNote, "VAT note", 1, 500, true),
        });
        if (metadata.error) throw friendly(metadata.error);
        return metadata.data as Record<string, unknown>;
      }
      return result.data as Record<string, unknown>;
    }

    if (action.startsWith("credit-note-")) {
      const noteAction = action.replace("credit-note-", "");
      const result = await admin.rpc("apply_credit_note_command", {
        p_workspace_id: workspaceId,
        p_credit_note_id: uuid(body.id, "Credit Note"),
        p_action: noteAction,
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_invoice_id: noteAction === "create" ? uuid(body.invoiceId, "Invoice") : null,
        p_expected_version: noteAction === "create" ? null : integer(body.expectedVersion, "Credit Note version"),
        p_reason: ["create", "update"].includes(noteAction) ? text(body.reason, "Credit reason", 5, 500) : null,
        p_notes: text(body.notes, "Notes", 1, 2000, true),
        p_lines: ["create", "update"].includes(noteAction) ? creditLines(body.lines) : [],
        p_void_reason: noteAction === "void" ? text(body.voidReason ?? body.reason, "Void reason", 5, 500) : null,
      });
      if (result.error) throw friendly(result.error);
      return result.data as Record<string, unknown>;
    }

    const noteAction = action.replace("delivery-note-", "");
    const result = await admin.rpc("apply_delivery_note_command", {
      p_workspace_id: workspaceId,
      p_delivery_note_id: uuid(body.id, "Delivery Note"),
      p_action: noteAction,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_source_invoice_id: noteAction === "create" ? uuid(body.sourceInvoiceId, "Source Invoice", true) : null,
      p_source_sale_id: noteAction === "create" ? uuid(body.sourceSaleId, "Source Sale", true) : null,
      p_expected_version: noteAction === "create" ? null : integer(body.expectedVersion, "Delivery Note version"),
      p_delivery_date: ["create", "update"].includes(noteAction) ? dateValue(body.deliveryDate, "Delivery date") : null,
      p_delivery_address: ["create", "update"].includes(noteAction) ? text(body.deliveryAddress, "Delivery address", 1, 500) : null,
      p_notes: text(body.notes, "Notes", 1, 2000, true),
      p_lines: ["create", "update"].includes(noteAction) ? deliveryLines(body.lines) : [],
      p_void_reason: noteAction === "void" ? text(body.voidReason ?? body.reason, "Void reason", 5, 500) : null,
    });
    if (result.error) throw friendly(result.error);
    return result.data as Record<string, unknown>;
  });
}
