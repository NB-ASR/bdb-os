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
const MAX_FILE_SIZE = 10_000_000;
const LINK_TYPES = new Set([
  "business",
  "customer",
  "appointment",
  "sale",
  "invoice",
  "customer_payment",
  "communication",
]);
const ACTIONS = new Set(["add_link", "revoke_link", "archive_document"]);

type DocumentCommandBody = Record<string, unknown> & {
  workspaceId?: unknown;
  documentId?: unknown;
  action?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_DOCUMENT_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalUuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_DOCUMENT_INPUT", `${field} is invalid.`);
  }
  return result;
}

function text(value: unknown, field: string, minimum: number, maximum: number) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_DOCUMENT_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalText(value: unknown, field: string, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) {
    throw new CommandError("INVALID_DOCUMENT_INPUT", `${field} is too long.`);
  }
  return result;
}

function timestamp(value: unknown) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return new Date().toISOString();
  }
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new CommandError("INVALID_DOCUMENT_INPUT", "Document date is invalid.");
  }
  return parsed.toISOString();
}

function fileSize(bytes: number) {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

function documentType(file: File) {
  if (file.type.startsWith("image/")) return "Image";
  const extension = file.name.split(".").at(-1)?.trim().toUpperCase();
  return extension || "File";
}

function storageName(value: string) {
  const safe = value.toLowerCase().replace(/[^a-z0-9.-]/g, "-").replace(/-+/g, "-");
  return safe.slice(0, 180) || "document";
}

function friendlyError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied")) {
    return new CommandError("DOCUMENT_FORBIDDEN", "You do not have permission to change this Document.", 403);
  }
  if (message.includes("source access denied")) {
    return new CommandError("DOCUMENT_SOURCE_FORBIDDEN", "You cannot link a Document to that restricted record.", 403);
  }
  if (message.includes("not found")) {
    return new CommandError("DOCUMENT_NOT_FOUND", error.message, 404);
  }
  if (message.includes("already") || message.includes("conflict") || error.code === "23505") {
    return new CommandError("DOCUMENT_CONFLICT", error.message, 409);
  }
  return new CommandError("DOCUMENT_COMMAND_FAILED", error.message, 400);
}

async function existingReceipt(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  workspaceId: string,
  idempotencyKey: string,
) {
  const result = await admin
    .from("document_command_receipts")
    .select("result")
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", idempotencyKey)
    .maybeSingle();
  if (result.error) throw friendlyError(result.error);
  return result.data?.result as Record<string, unknown> | undefined;
}

async function createDocument(request: Request) {
  const form = await request.formData();
  const workspaceId = uuid(form.get("workspaceId"), "Workspace");
  const context = await requireWorkspaceCommand(request, workspaceId);
  if (!context.idempotencyKey) {
    throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Document changes.");
  }

  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

  const previous = await existingReceipt(admin, workspaceId, context.idempotencyKey);
  if (previous) return previous;

  const documentId = uuid(form.get("documentId"), "Document ID");
  const linkId = uuid(form.get("linkId"), "Document link ID");
  const linkType = text(form.get("linkType"), "Document link type", 1, 40);
  if (!LINK_TYPES.has(linkType)) {
    throw new CommandError("INVALID_DOCUMENT_LINK_TYPE", "Document link type is invalid.");
  }
  const targetId = linkType === "business"
    ? null
    : optionalUuid(form.get("targetId"), "Linked record");
  if (linkType !== "business" && !targetId) {
    throw new CommandError("INVALID_DOCUMENT_TARGET", "A linked record is required.");
  }

  const file = form.get("file");
  if (!(file instanceof File) || file.size < 1) {
    throw new CommandError("DOCUMENT_FILE_REQUIRED", "Choose a file to upload.");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new CommandError("DOCUMENT_FILE_TOO_LARGE", "Document files must be 10 MB or smaller.");
  }

  const name = text(form.get("name") || file.name, "Document name", 1, 240);
  const category = text(form.get("category") || "general", "Document category", 1, 80);
  const description = optionalText(form.get("description"), "Document description", 2000);
  const uploadedAt = timestamp(form.get("uploadedAt"));
  const year = new Date(uploadedAt).getUTCFullYear();
  const storagePath = `${workspaceId}/documents/${year}/${documentId}-${storageName(file.name)}`;

  const existingDocument = await admin
    .from("documents")
    .select("id")
    .eq("workspace_id", workspaceId)
    .eq("id", documentId)
    .maybeSingle();
  if (existingDocument.error) throw friendlyError(existingDocument.error);
  if (existingDocument.data) {
    throw new CommandError("DOCUMENT_CONFLICT", "A Document already uses this identity.", 409);
  }

  let upload = await admin.storage
    .from("workspace-documents")
    .upload(storagePath, file, { cacheControl: "3600", upsert: false, contentType: file.type });

  if (upload.error && upload.error.message.toLowerCase().includes("already exists")) {
    await admin.storage.from("workspace-documents").remove([storagePath]);
    upload = await admin.storage
      .from("workspace-documents")
      .upload(storagePath, file, { cacheControl: "3600", upsert: false, contentType: file.type });
  }
  if (upload.error) {
    throw new CommandError("DOCUMENT_STORAGE_FAILED", `The file could not be stored: ${upload.error.message}`, 500);
  }

  const result = await admin.rpc("create_general_document", {
    p_workspace_id: workspaceId,
    p_document_id: documentId,
    p_link_id: linkId,
    p_link_type: linkType,
    p_target_id: targetId,
    p_name: name,
    p_original_file_name: file.name,
    p_document_type: documentType(file),
    p_mime_type: file.type || "application/octet-stream",
    p_size_label: fileSize(file.size),
    p_size_bytes: file.size,
    p_category: category,
    p_description: description,
    p_storage_path: storagePath,
    p_idempotency_key: context.idempotencyKey,
    p_actor_user_id: context.userId,
    p_command_id: context.commandId,
    p_uploaded_at: uploadedAt,
  });

  if (result.error) {
    await admin.storage.from("workspace-documents").remove([storagePath]).catch(() => undefined);
    throw friendlyError(result.error);
  }
  return result.data as Record<string, unknown>;
}

async function applyDocumentCommand(request: Request) {
  const body = await parseCommandBody<DocumentCommandBody>(request);
  const workspaceId = uuid(body.workspaceId, "Workspace");
  const documentId = uuid(body.documentId, "Document ID");
  const action = text(body.action, "Document action", 1, 40);
  if (!ACTIONS.has(action)) {
    throw new CommandError("INVALID_DOCUMENT_ACTION", "Document action is invalid.");
  }

  const context = await requireWorkspaceCommand(request, workspaceId);
  if (!context.idempotencyKey) {
    throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Document changes.");
  }
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

  const previous = await existingReceipt(admin, workspaceId, context.idempotencyKey);
  if (previous) return previous;

  let result;
  if (action === "add_link") {
    const linkType = text(body.linkType, "Document link type", 1, 40);
    if (!LINK_TYPES.has(linkType)) {
      throw new CommandError("INVALID_DOCUMENT_LINK_TYPE", "Document link type is invalid.");
    }
    const targetId = linkType === "business" ? null : optionalUuid(body.targetId, "Linked record");
    if (linkType !== "business" && !targetId) {
      throw new CommandError("INVALID_DOCUMENT_TARGET", "A linked record is required.");
    }
    result = await admin.rpc("add_general_document_link", {
      p_workspace_id: workspaceId,
      p_document_id: documentId,
      p_link_id: uuid(body.linkId, "Document link ID"),
      p_link_type: linkType,
      p_target_id: targetId,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_occurred_at: timestamp(body.occurredAt),
    });
  } else if (action === "revoke_link") {
    result = await admin.rpc("revoke_general_document_link", {
      p_workspace_id: workspaceId,
      p_document_id: documentId,
      p_link_id: uuid(body.linkId, "Document link ID"),
      p_reason: text(body.reason, "Revoke reason", 5, 500),
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_occurred_at: timestamp(body.occurredAt),
    });
  } else {
    result = await admin.rpc("archive_general_document", {
      p_workspace_id: workspaceId,
      p_document_id: documentId,
      p_reason: text(body.reason, "Archive reason", 5, 500),
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_occurred_at: timestamp(body.occurredAt),
    });
  }

  if (result.error) throw friendlyError(result.error);
  return result.data as Record<string, unknown>;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const result = await supabase
      .from("general_document_index")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("uploaded_at", { ascending: false });
    if (result.error) throw friendlyError(result.error);
    return { documents: result.data ?? [] };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
    return contentType.includes("multipart/form-data")
      ? createDocument(request)
      : applyDocumentCommand(request);
  });
}
