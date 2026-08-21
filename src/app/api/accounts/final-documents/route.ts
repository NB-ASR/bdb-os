import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CommandError, parseCommandBody, requireWorkspaceCommand, runCommand } from "@/lib/server/command";
import { hashJson } from "@/lib/server/workspace-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DOCUMENT_TYPES = new Set(["invoice", "credit_note", "delivery_note"]);
const ACTIONS = new Set(["invoice-create-manual", "invoice-create-sale", "credit-note-create", "delivery-note-create", "document-note-add"]);
type Body = Record<string, unknown> & { workspaceId?: unknown; action?: unknown };
type RawLine = Record<string, unknown>;

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
function numberValue(value: unknown, field: string, options: { minimum?: number; maximum?: number; positive?: boolean } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} must be a number.`);
  if (options.positive && result <= 0) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} must be greater than zero.`);
  if (options.minimum !== undefined && result < options.minimum) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is below the allowed minimum.`);
  if (options.maximum !== undefined && result > options.maximum) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} exceeds the allowed maximum.`);
  return result;
}
function dateValue(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  const result = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result) || Number.isNaN(new Date(`${result}T00:00:00Z`).getTime())) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  return result;
}
function lines(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} must contain between 1 and 100 lines.`);
  return value as RawLine[];
}
function round4(value: number) { return Math.round((value + Number.EPSILON) * 10000) / 10000; }
function adminClient() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}
function friendly(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied")) return new CommandError("ACCOUNTS_FORBIDDEN", "You do not have permission to perform this Accounts action.", 403);
  if (message.includes("not found") || message.includes("unavailable")) return new CommandError("ACCOUNTS_NOT_FOUND", error.message, 404);
  if (message.includes("idempotency key") || message.includes("exceeds") || message.includes("issued") || message.includes("cancelled") || message.includes("immutable") || message.includes("catalogue") || error.code === "23505") return new CommandError("ACCOUNTS_STATE_CONFLICT", error.message, 409);
  return new CommandError("ACCOUNTS_COMMAND_FAILED", error.message, 400);
}

async function catalogueInvoiceLines(admin: ReturnType<typeof adminClient>, workspaceId: string, value: unknown) {
  const rawLines = lines(value, "Invoice");
  const parsed = rawLines.map((raw, index) => {
    const lineType = String(raw.lineType ?? "").trim();
    if (lineType !== "product" && lineType !== "service") throw new CommandError("INVALID_INVOICE_LINES", `Invoice line ${index + 1} must reference a Product or Service.`);
    return {
      id: uuid(raw.id, `Invoice line ${index + 1} ID`),
      lineType,
      productId: lineType === "product" ? uuid(raw.productId, `Invoice line ${index + 1} Product`) : null,
      serviceId: lineType === "service" ? uuid(raw.serviceId, `Invoice line ${index + 1} Service`) : null,
      quantity: numberValue(raw.quantity, `Invoice line ${index + 1} quantity`, { positive: true, maximum: 100000 }),
      discountPercent: numberValue(raw.discountPercent ?? 0, `Invoice line ${index + 1} discount`, { minimum: 0, maximum: 100 }),
    };
  });
  const productIds = parsed.flatMap((line) => line.productId ? [line.productId] : []);
  const serviceIds = parsed.flatMap((line) => line.serviceId ? [line.serviceId] : []);
  const [productsResult, servicesResult] = await Promise.all([
    productIds.length ? admin.from("products").select("id,sku,name,selling_price,vat_rate,status").eq("workspace_id", workspaceId).in("id", productIds) : Promise.resolve({ data: [], error: null }),
    serviceIds.length ? admin.from("services").select("id,code,name,price,vat_rate,status").eq("workspace_id", workspaceId).in("id", serviceIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (productsResult.error) throw productsResult.error;
  if (servicesResult.error) throw servicesResult.error;
  const products = new Map((productsResult.data ?? []).map((item) => [String(item.id), item]));
  const services = new Map((servicesResult.data ?? []).map((item) => [String(item.id), item]));

  return parsed.map((line, index) => {
    const source = line.lineType === "product" ? products.get(String(line.productId)) : services.get(String(line.serviceId));
    if (!source || source.status !== "active") throw new CommandError("ACCOUNTS_STATE_CONFLICT", `Invoice line ${index + 1} catalogue item is unavailable.`, 409);
    const unitPrice = line.lineType === "product" ? Number("selling_price" in source ? source.selling_price : 0) : Number("price" in source ? source.price : 0);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) throw new CommandError("ACCOUNTS_STATE_CONFLICT", `Invoice line ${index + 1} catalogue price is unavailable.`, 409);
    const vatRate = Number(source.vat_rate ?? 0);
    const gross = round4(line.quantity * unitPrice);
    const discountAmount = round4(gross * line.discountPercent / 100);
    return {
      id: line.id,
      lineType: line.lineType,
      productId: line.productId,
      serviceId: line.serviceId,
      description: String(source.name ?? ""),
      quantity: line.quantity,
      unitPrice,
      discountPercent: line.discountPercent,
      discountAmount,
      vatRate,
    };
  });
}

function quantityCreditLines(value: unknown) {
  const sourceIds = new Set<string>();
  return lines(value, "Credit Note").map((raw, index) => {
    if (raw.amount !== undefined && raw.amount !== null && raw.amount !== "") throw new CommandError("INVALID_CREDIT_NOTE_LINES", "Credit Notes cannot be created from an arbitrary monetary amount. Use full cancellation or a genuine Product / Service quantity.");
    const sourceInvoiceLineId = uuid(raw.sourceInvoiceLineId, `Credit Note line ${index + 1} source`) as string;
    if (sourceIds.has(sourceInvoiceLineId)) throw new CommandError("INVALID_CREDIT_NOTE_LINES", "Each original Invoice line can appear only once on a Credit Note.");
    sourceIds.add(sourceInvoiceLineId);
    return {
      id: uuid(raw.id, `Credit Note line ${index + 1} ID`),
      sourceInvoiceLineId,
      quantity: numberValue(raw.quantity, `Credit Note line ${index + 1} quantity`, { positive: true, maximum: 100000 }),
    };
  });
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace") as string;
    const documentId = uuid(url.searchParams.get("documentId"), "Document") as string;
    const documentType = String(url.searchParams.get("documentType") ?? "").trim();
    if (!DOCUMENT_TYPES.has(documentType)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Business document type is invalid.");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const notes = await supabase.from("business_document_notes").select("id,note,created_at,created_by").eq("workspace_id", workspaceId).eq("document_type", documentType).eq("document_id", documentId).order("created_at", { ascending: true });
    if (notes.error) throw notes.error;
    return { notes: notes.data ?? [] };
  });
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
    const claim = await admin.rpc("claim_accounts_command", {
      p_workspace_id: workspaceId,
      p_idempotency_key: context.idempotencyKey,
      p_request_hash: hashJson({ workspaceId, action, body }),
    });
    if (claim.error) throw friendly(claim.error);

    let result: { data: unknown; error: { message: string; code?: string | null } | null };

    if (action === "invoice-create-manual" || action === "invoice-create-sale") {
      const canonicalLines = action === "invoice-create-manual" ? await catalogueInvoiceLines(admin, workspaceId, body.lines) : [];
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
        p_lines: canonicalLines,
        p_sales_order_reference: body.salesOrderReference === undefined ? null : optionalText(body.salesOrderReference, 64),
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
        p_lines: quantityCreditLines(body.lines),
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
      if (!DOCUMENT_TYPES.has(documentType)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Business document type is invalid.");
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
