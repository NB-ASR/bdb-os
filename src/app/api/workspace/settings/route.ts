import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";
import { hashJson, sha256Bytes, sha256Text } from "@/lib/server/workspace-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const MAX_LOGO_BYTES = 5_000_000;

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_SETTINGS_INPUT", `${field} is invalid.`);
  }
  return result;
}

function requireAdmin() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}

function databaseCommandError(error: { message?: string } | null, fallback: string): never {
  const message = String(error?.message ?? fallback);
  const forbidden = /not permitted|restricted to the owner/i.test(message);
  throw new CommandError(
    forbidden ? "SETTINGS_FORBIDDEN" : "SETTINGS_REJECTED",
    message,
    forbidden ? 403 : 409,
  );
}

async function getAccess(workspaceId: string) {
  const supabase = await createClient();
  if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  const result = await supabase.rpc("get_workspace_settings_access", {
    target_workspace_id: workspaceId,
  });
  if (result.error) throw result.error;
  const row = ((result.data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
  return {
    canView: Boolean(row.can_view),
    canManage: Boolean(row.can_manage),
    canRecover: Boolean(row.can_recover),
    supportReadOnly: Boolean(row.support_read_only),
    restorableRecordCount: Number(row.restorable_record_count ?? 0),
  };
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);

    const access = await getAccess(workspaceId);
    if (!access.canView) {
      throw new CommandError("SETTINGS_FORBIDDEN", "Workspace settings are not available.", 403);
    }

    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [workspaceResult, settingsResult, themeResult] = await Promise.all([
      supabase.from("workspaces").select("id,name,legal_name").eq("id", workspaceId).maybeSingle(),
      supabase.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
      supabase.from("workspace_themes").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    ]);
    for (const result of [workspaceResult, settingsResult, themeResult]) {
      if (result.error) throw result.error;
    }
    if (!workspaceResult.data) {
      throw new CommandError("SETTINGS_NOT_FOUND", "Workspace settings could not be found.", 404);
    }

    const settings = (settingsResult.data ?? {}) as Record<string, unknown>;
    const theme = (themeResult.data ?? {}) as Record<string, unknown>;
    let clientLogoUrl: string | null = null;
    if (theme.client_logo_path) {
      const signed = await supabase.storage
        .from("workspace-assets")
        .createSignedUrl(String(theme.client_logo_path), 3600);
      if (signed.error) throw signed.error;
      clientLogoUrl = signed.data?.signedUrl ?? null;
    }

    return {
      workspaceId,
      businessName: String(workspaceResult.data.name ?? ""),
      legalName: workspaceResult.data.legal_name ? String(workspaceResult.data.legal_name) : "",
      ownerName: String(settings.owner_name ?? ""),
      email: String(settings.email ?? ""),
      phone: String(settings.phone ?? ""),
      currency: String(settings.currency ?? "EUR"),
      invoicePrefix: String(settings.invoice_prefix ?? "INV"),
      vatRate: Number(settings.vat_rate ?? 0),
      timezone: String(settings.timezone ?? "Europe/Malta"),
      theme: {
        preset: String(theme.preset ?? "obsidian-gold"),
        mode: String(theme.mode ?? "dark"),
        accentColor: String(theme.accent_color ?? "#d3a84b"),
        fontFamily: String(theme.font_family ?? "manrope"),
        textScale: Number(theme.text_scale ?? 1),
        density: String(theme.density ?? "comfortable"),
        highContrast: Boolean(theme.high_contrast),
        reducedMotion: Boolean(theme.reduced_motion),
        clientLogoPath: theme.client_logo_path ? String(theme.client_logo_path) : null,
        clientLogoUrl,
      },
      access: {
        canManage: access.canManage,
        canRecover: access.canRecover,
        supportReadOnly: access.supportReadOnly,
      },
      recovery: {
        restorableRecordCount: access.restorableRecordCount,
      },
      cached: false,
      generatedAt: new Date().toISOString(),
    };
  });
}

async function updateConfiguration(request: Request) {
  const body = await parseCommandBody<Record<string, unknown>>(request);
  const workspaceId = uuid(body.workspaceId, "Workspace");
  const context = await requireWorkspaceCommand(request, workspaceId);
  if (!context.idempotencyKey) {
    throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required.", 400);
  }

  const payload = {
    businessName: String(body.businessName ?? ""),
    legalName: String(body.legalName ?? ""),
    ownerName: String(body.ownerName ?? ""),
    email: String(body.email ?? ""),
    phone: String(body.phone ?? ""),
    currency: String(body.currency ?? ""),
    invoicePrefix: String(body.invoicePrefix ?? ""),
    vatRate: Number(body.vatRate),
    timezone: String(body.timezone ?? ""),
    theme: body.theme,
  };
  const requestHash = hashJson({ action: "update_configuration", workspaceId, payload });
  const admin = requireAdmin();
  const result = await admin.rpc("update_workspace_configuration", {
    target_workspace_id: workspaceId,
    target_actor_user_id: context.userId,
    target_idempotency_key: context.idempotencyKey,
    target_request_hash: requestHash,
    target_business_name: payload.businessName,
    target_legal_name: payload.legalName,
    target_owner_name: payload.ownerName,
    target_email: payload.email,
    target_phone: payload.phone,
    target_currency: payload.currency,
    target_invoice_prefix: payload.invoicePrefix,
    target_vat_rate: payload.vatRate,
    target_timezone: payload.timezone,
    target_theme: payload.theme,
    target_command_id: context.commandId,
    target_occurred_at: new Date().toISOString(),
  });
  if (result.error) databaseCommandError(result.error, "Workspace settings could not be saved.");
  return result.data;
}

async function uploadLogo(request: Request) {
  const form = await request.formData();
  const workspaceId = uuid(form.get("workspaceId"), "Workspace");
  const context = await requireWorkspaceCommand(request, workspaceId);
  if (!context.idempotencyKey) {
    throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required.", 400);
  }

  const access = await getAccess(workspaceId);
  if (!access.canManage) {
    throw new CommandError("SETTINGS_FORBIDDEN", "Workspace appearance cannot be changed.", 403);
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    throw new CommandError("LOGO_REQUIRED", "Choose a logo file.", 400);
  }
  if (!LOGO_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_LOGO_BYTES) {
    throw new CommandError(
      "INVALID_LOGO",
      "Use a PNG, JPG, WebP or SVG logo no larger than 5 MB.",
      400,
    );
  }

  const bytes = await file.arrayBuffer();
  const fileHash = sha256Bytes(bytes);
  const requestHash = sha256Text(
    `${file.name}\n${file.type}\n${file.size}\n${fileHash}`,
  );
  const admin = requireAdmin();

  const receipt = await admin
    .from("workspace_recovery_receipts")
    .select("action,request_hash,result")
    .eq("workspace_id", workspaceId)
    .eq("idempotency_key", context.idempotencyKey)
    .maybeSingle();
  if (receipt.error) throw receipt.error;
  if (receipt.data) {
    if (receipt.data.action !== "set_logo" || receipt.data.request_hash !== requestHash) {
      throw new CommandError(
        "IDEMPOTENCY_CONFLICT",
        "This logo command key was already used with different content.",
        409,
      );
    }
    return receipt.data.result;
  }

  const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]/g, "-").slice(-100);
  const commandSlug = createHash("sha256")
    .update(context.idempotencyKey)
    .digest("hex")
    .slice(0, 24);
  const path = `${workspaceId}/branding/${commandSlug}-${safeName}`;

  const upload = await admin.storage
    .from("workspace-assets")
    .upload(path, bytes, { contentType: file.type, cacheControl: "3600", upsert: true });
  if (upload.error) throw new CommandError("LOGO_UPLOAD_FAILED", upload.error.message, 409);

  const result = await admin.rpc("set_workspace_logo", {
    target_workspace_id: workspaceId,
    target_actor_user_id: context.userId,
    target_idempotency_key: context.idempotencyKey,
    target_request_hash: requestHash,
    target_logo_path: path,
    target_command_id: context.commandId,
    target_occurred_at: new Date().toISOString(),
  });
  if (result.error) {
    await admin.storage.from("workspace-assets").remove([path]).catch(() => undefined);
    databaseCommandError(result.error, "Workspace logo could not be saved.");
  }

  const payload = (result.data ?? {}) as Record<string, unknown>;
  const previousPath = payload.previousLogoPath ? String(payload.previousLogoPath) : "";
  if (previousPath && previousPath !== path) {
    await admin.storage.from("workspace-assets").remove([previousPath]).catch(() => undefined);
  }

  const signed = await admin.storage.from("workspace-assets").createSignedUrl(path, 3600);
  if (signed.error) throw signed.error;
  return { ...payload, clientLogoUrl: signed.data?.signedUrl ?? null };
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const contentType = request.headers.get("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) return uploadLogo(request);

    const clone = request.clone();
    const body = await clone.json().catch(() => null) as Record<string, unknown> | null;
    if (body?.action !== "update_configuration") {
      throw new CommandError("INVALID_SETTINGS_ACTION", "The settings action is invalid.", 400);
    }
    return updateConfiguration(request);
  });
}
