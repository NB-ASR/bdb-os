import { createHash, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ActualFileType = {
  mimeType: "application/pdf" | "image/png" | "image/jpeg" | "image/webp";
  extension: "pdf" | "png" | "jpg" | "webp";
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_PURCHASING_INPUT", `${field} is invalid.`);
  return result;
}

function detectFileType(bytes: Uint8Array): ActualFileType | null {
  if (bytes.length >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-") {
    return { mimeType: "application/pdf", extension: "pdf" };
  }
  if (bytes.length >= 8
    && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { mimeType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mimeType: "image/jpeg", extension: "jpg" };
  }
  if (bytes.length >= 12
    && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF"
    && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") {
    return { mimeType: "image/webp", extension: "webp" };
  }
  return null;
}

function safeFileName(value: string) {
  const cleaned = value.normalize("NFKC").replace(/[\\/\u0000-\u001f\u007f]/g, "-").trim();
  return (cleaned || "supplier-document").slice(0, 240);
}

function friendlyUploadError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("supplier_documents_workspace_hash_idx")) {
    return new CommandError("SUPPLIER_DOCUMENT_DUPLICATE_FILE", "This exact document has already been uploaded to the workspace.", 409);
  }
  if (message.includes("write access denied")) {
    return new CommandError("SUPPLIER_DOCUMENT_FORBIDDEN", "You do not have permission to upload Purchasing documents.", 403);
  }
  if (error.code === "23505" || message.includes("duplicate key")) {
    return new CommandError("SUPPLIER_DOCUMENT_DUPLICATE", "This supplier document already exists.", 409);
  }
  return new CommandError("SUPPLIER_DOCUMENT_UPLOAD_FAILED", error.message, 400);
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [documentsResult, linesResult, suppliersResult] = await Promise.all([
      supabase
        .from("supplier_documents")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("created_at", { ascending: false }),
      supabase
        .from("supplier_document_lines")
        .select("document_id,review_status")
        .eq("workspace_id", workspaceId),
      supabase
        .from("suppliers")
        .select("id,code,name")
        .eq("workspace_id", workspaceId),
    ]);
    const failed = [documentsResult, linesResult, suppliersResult].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const counts = new Map<string, { total: number; attention: number }>();
    for (const line of linesResult.data ?? []) {
      const current = counts.get(line.document_id) ?? { total: 0, attention: 0 };
      current.total += 1;
      if (line.review_status === "needs_review") current.attention += 1;
      counts.set(line.document_id, current);
    }
    const supplierMap = new Map((suppliersResult.data ?? []).map((supplier) => [supplier.id, supplier]));

    return {
      workspaceId,
      documents: (documentsResult.data ?? []).map((document) => ({
        ...document,
        supplier: document.supplier_id ? supplierMap.get(document.supplier_id) ?? null : null,
        line_count: counts.get(document.id)?.total ?? 0,
        attention_count: counts.get(document.id)?.attention ?? 0,
      })),
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const form = await request.formData();
    const workspaceId = uuid(form.get("workspaceId"), "Workspace");
    const documentId = uuid(form.get("documentId"), "Document ID");
    const currency = String(form.get("currency") ?? "EUR").trim().toUpperCase();
    const file = form.get("file");
    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for document uploads.");
    }
    if (!(file instanceof File)) throw new CommandError("DOCUMENT_REQUIRED", "Choose a supplier invoice or credit note.");
    if (file.size < 1 || file.size > MAX_FILE_SIZE) {
      throw new CommandError("DOCUMENT_SIZE_INVALID", "Documents must be between 1 byte and 20 MB.", 413);
    }
    if (!/^[A-Z]{3}$/.test(currency)) throw new CommandError("DOCUMENT_CURRENCY_INVALID", "Currency must be a three-letter code.");

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const receiptResult = await admin
      .from("supplier_document_command_receipts")
      .select("result")
      .eq("workspace_id", workspaceId)
      .eq("idempotency_key", context.idempotencyKey)
      .maybeSingle();
    if (receiptResult.error) throw receiptResult.error;
    if (receiptResult.data?.result) return receiptResult.data.result as Record<string, unknown>;

    const bytes = new Uint8Array(await file.arrayBuffer());
    const actualType = detectFileType(bytes);
    if (!actualType) {
      throw new CommandError("DOCUMENT_TYPE_INVALID", "Only genuine PDF, JPG, PNG and WebP documents are supported.");
    }

    const hash = createHash("sha256").update(bytes).digest("hex");
    const fileName = safeFileName(file.name);
    const storagePath = `${workspaceId}/purchasing/${documentId}/original.${actualType.extension}`;
    const uploadResult = await admin.storage.from("workspace-documents").upload(storagePath, bytes, {
      contentType: actualType.mimeType,
      upsert: false,
      cacheControl: "3600",
    });
    if (uploadResult.error) {
      if (uploadResult.error.message.toLowerCase().includes("already exists")) {
        throw new CommandError("SUPPLIER_DOCUMENT_UPLOAD_RETRY_CONFLICT", "The upload path already exists. Refresh the Purchasing register before retrying.", 409);
      }
      throw uploadResult.error;
    }

    const commandId = randomUUID();
    const rpcResult = await admin.rpc("apply_supplier_document_upload", {
      p_workspace_id: workspaceId,
      p_document_id: documentId,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: commandId,
      p_file_path: storagePath,
      p_file_name: fileName,
      p_mime_type: actualType.mimeType,
      p_file_size: file.size,
      p_file_sha256: hash,
      p_currency: currency,
    });
    if (rpcResult.error) {
      await admin.storage.from("workspace-documents").remove([storagePath]);
      throw friendlyUploadError(rpcResult.error);
    }

    return rpcResult.data as Record<string, unknown>;
  });
}
