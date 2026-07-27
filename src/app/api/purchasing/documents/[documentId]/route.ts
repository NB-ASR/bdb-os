import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CommandError, parseCommandBody, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ReviewBody = Record<string, unknown> & {
  workspaceId?: unknown;
  action?: unknown;
  expectedVersion?: unknown;
  header?: unknown;
  lines?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_PURCHASING_INPUT", `${field} is invalid.`);
  return result;
}

function version(value: unknown) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new CommandError("INVALID_SUPPLIER_DOCUMENT_VERSION", "Refresh the supplier document before saving.");
  }
  return result;
}

function friendlyReviewError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("changed on another device")) {
    return new CommandError("SUPPLIER_DOCUMENT_CONFLICT", "This document changed on another device. Refresh before saving.", 409);
  }
  if (message.includes("write access denied")) {
    return new CommandError("SUPPLIER_DOCUMENT_FORBIDDEN", "You do not have permission to review Purchasing documents.", 403);
  }
  if (message.includes("workspace_number_idx") || error.code === "23505" || message.includes("duplicate key")) {
    return new CommandError("SUPPLIER_DOCUMENT_NUMBER_DUPLICATE", "This Supplier already has a document with the same number and type.", 409);
  }
  if (message.includes("every product line")) {
    return new CommandError("SUPPLIER_DOCUMENT_LINES_UNRESOLVED", "Match every Product line or mark it as a non-stock expense before approval.", 409);
  }
  if (message.includes("approved or archived")) {
    return new CommandError("SUPPLIER_DOCUMENT_LOCKED", "Approved or archived supplier documents cannot be edited.", 409);
  }
  return new CommandError("SUPPLIER_DOCUMENT_REVIEW_FAILED", error.message, 400);
}

export async function GET(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  return runCommand(async () => {
    const { documentId: rawDocumentId } = await context.params;
    const documentId = uuid(rawDocumentId, "Document ID");
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);

    const supabase = await createClient();
    const admin = createAdminClient();
    if (!supabase || !admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [documentResult, linesResult, suppliersResult, productsResult, relationshipsResult] = await Promise.all([
      supabase
        .from("supplier_documents")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", documentId)
        .maybeSingle(),
      supabase
        .from("supplier_document_lines")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("document_id", documentId)
        .order("line_number"),
      supabase
        .from("suppliers")
        .select("id,code,name,supplier_type,status,document_currency,payment_terms_days")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name"),
      supabase
        .from("products")
        .select("id,sku,name,barcode,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name"),
      supabase
        .from("product_suppliers")
        .select("id,product_id,supplier_id,supplier_sku,status,is_preferred")
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
    ]);
    const failed = [documentResult, linesResult, suppliersResult, productsResult, relationshipsResult].find((result) => result.error);
    if (failed?.error) throw failed.error;
    if (!documentResult.data) throw new CommandError("SUPPLIER_DOCUMENT_NOT_FOUND", "The supplier document could not be found.", 404);

    const signedResult = await admin.storage
      .from(documentResult.data.file_bucket)
      .createSignedUrl(documentResult.data.file_path, 300);
    if (signedResult.error) throw signedResult.error;

    return {
      workspaceId,
      document: documentResult.data,
      lines: linesResult.data ?? [],
      suppliers: suppliersResult.data ?? [],
      products: productsResult.data ?? [],
      relationships: relationshipsResult.data ?? [],
      originalFileUrl: signedResult.data.signedUrl,
    };
  });
}

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  return runCommand(async () => {
    const { documentId: rawDocumentId } = await context.params;
    const documentId = uuid(rawDocumentId, "Document ID");
    const body = await parseCommandBody<ReviewBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const action = String(body.action ?? "").trim();
    if (!new Set(["save_review", "approve"]).has(action)) {
      throw new CommandError("INVALID_SUPPLIER_DOCUMENT_ACTION", "Supplier document review action is invalid.");
    }
    if (!body.header || typeof body.header !== "object" || Array.isArray(body.header)) {
      throw new CommandError("INVALID_SUPPLIER_DOCUMENT_HEADER", "A reviewed document header is required.");
    }
    if (!Array.isArray(body.lines)) {
      throw new CommandError("INVALID_SUPPLIER_DOCUMENT_LINES", "Reviewed supplier-document lines are required.");
    }

    const commandContext = await requireWorkspaceCommand(request, workspaceId);
    if (!commandContext.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for document review changes.");
    }
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const result = await admin.rpc("apply_supplier_document_review", {
      p_workspace_id: workspaceId,
      p_document_id: documentId,
      p_action: action,
      p_idempotency_key: commandContext.idempotencyKey,
      p_actor_user_id: commandContext.userId,
      p_command_id: commandContext.commandId,
      p_expected_version: version(body.expectedVersion),
      p_header: body.header,
      p_lines: body.lines,
    });
    if (result.error) throw friendlyReviewError(result.error);
    return result.data as Record<string, unknown>;
  });
}
