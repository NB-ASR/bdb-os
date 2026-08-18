import { createHash } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ALLOWED_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_FILE_BYTES = 2_000_000;

function workspaceId(value: unknown) {
  const id = String(value ?? "").trim();
  if (!UUID_PATTERN.test(id)) throw new Error("INVALID_WORKSPACE");
  return id;
}

function adminClient() {
  const admin = createAdminClient();
  if (!admin) throw new Error("NOT_CONFIGURED");
  return admin;
}

function safeFileName(name: string) {
  const cleaned = name.toLowerCase().replace(/[^a-z0-9._-]/g, "-").replace(/-+/g, "-").slice(-90);
  return cleaned || "logo";
}

async function assertWorkspace(admin: ReturnType<typeof adminClient>, id: string) {
  const { data, error } = await admin.from("workspaces").select("id,name").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("WORKSPACE_NOT_FOUND");
  return data;
}

async function signedLogo(admin: ReturnType<typeof adminClient>, path: string | null) {
  if (!path) return null;
  const signed = await admin.storage.from("workspace-assets").createSignedUrl(path, 3600);
  if (signed.error) throw signed.error;
  return signed.data?.signedUrl ?? null;
}

async function writeAudit(admin: ReturnType<typeof adminClient>, record: Record<string, unknown>) {
  const { error } = await admin.from("audit_logs").insert(record);
  if (error) throw error;
}

function brandingError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message === "INVALID_WORKSPACE") return Response.json({ error: "Choose a valid client business." }, { status: 400 });
  if (message === "WORKSPACE_NOT_FOUND") return Response.json({ error: "The client business could not be found." }, { status: 404 });
  if (message === "THEME_NOT_FOUND") return Response.json({ error: "This business does not have a workspace appearance record yet." }, { status: 409 });
  return adminErrorResponse(error);
}

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin();
    const admin = adminClient();
    const url = new URL(request.url);
    const id = workspaceId(url.searchParams.get("workspaceId"));
    const workspace = await assertWorkspace(admin, id);

    const { data: theme, error } = await admin
      .from("workspace_themes")
      .select("client_logo_path,updated_at")
      .eq("workspace_id", id)
      .maybeSingle();
    if (error) throw error;

    const logoPath = theme?.client_logo_path ? String(theme.client_logo_path) : null;
    return Response.json({
      ok: true,
      workspaceId: id,
      workspaceName: workspace.name,
      logoPath,
      logoUrl: await signedLogo(admin, logoPath),
      updatedAt: theme?.updated_at ?? null,
    });
  } catch (error) {
    return brandingError(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = adminClient();
    const form = await request.formData();
    const id = workspaceId(form.get("workspaceId"));
    const workspace = await assertWorkspace(admin, id);
    const file = form.get("file");

    if (!(file instanceof File)) {
      return Response.json({ error: "Choose a company logo." }, { status: 400 });
    }
    if (!ALLOWED_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_FILE_BYTES) {
      return Response.json({ error: "Use a PNG, JPG or WebP logo no larger than 2 MB." }, { status: 400 });
    }

    const { data: existingTheme, error: themeError } = await admin
      .from("workspace_themes")
      .select("client_logo_path")
      .eq("workspace_id", id)
      .maybeSingle();
    if (themeError) throw themeError;
    if (!existingTheme) throw new Error("THEME_NOT_FOUND");

    const bytes = await file.arrayBuffer();
    const digest = createHash("sha256").update(Buffer.from(bytes)).digest("hex").slice(0, 18);
    const path = `${id}/branding/${Date.now()}-${digest}-${safeFileName(file.name)}`;

    const upload = await admin.storage
      .from("workspace-assets")
      .upload(path, bytes, { contentType: file.type, cacheControl: "3600", upsert: false });
    if (upload.error) throw upload.error;

    const previousPath = existingTheme.client_logo_path ? String(existingTheme.client_logo_path) : null;
    const updated = await admin
      .from("workspace_themes")
      .update({
        client_logo_path: path,
        updated_by: identity.userId,
        updated_at: new Date().toISOString(),
      })
      .eq("workspace_id", id);

    if (updated.error) {
      await admin.storage.from("workspace-assets").remove([path]).catch(() => undefined);
      throw updated.error;
    }

    if (previousPath && previousPath !== path) {
      await admin.storage.from("workspace-assets").remove([previousPath]).catch(() => undefined);
    }

    await writeAudit(admin, {
      actor_user_id: identity.userId,
      workspace_id: id,
      action: "admin.custom_branding.logo_updated",
      entity_type: "workspace",
      entity_id: id,
      metadata: { workspace_name: workspace.name, logo_path: path, previous_logo_path: previousPath },
    });

    return Response.json({
      ok: true,
      workspaceId: id,
      logoPath: path,
      logoUrl: await signedLogo(admin, path),
    });
  } catch (error) {
    return brandingError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = adminClient();
    const body = (await request.json().catch(() => ({}))) as { workspaceId?: string };
    const id = workspaceId(body.workspaceId);
    const workspace = await assertWorkspace(admin, id);

    const { data: theme, error: themeError } = await admin
      .from("workspace_themes")
      .select("client_logo_path")
      .eq("workspace_id", id)
      .maybeSingle();
    if (themeError) throw themeError;
    if (!theme) throw new Error("THEME_NOT_FOUND");

    const previousPath = theme.client_logo_path ? String(theme.client_logo_path) : null;
    const updated = await admin
      .from("workspace_themes")
      .update({ client_logo_path: null, updated_by: identity.userId, updated_at: new Date().toISOString() })
      .eq("workspace_id", id);
    if (updated.error) throw updated.error;

    if (previousPath) {
      await admin.storage.from("workspace-assets").remove([previousPath]).catch(() => undefined);
    }

    await writeAudit(admin, {
      actor_user_id: identity.userId,
      workspace_id: id,
      action: "admin.custom_branding.logo_removed",
      entity_type: "workspace",
      entity_id: id,
      metadata: { workspace_name: workspace.name, previous_logo_path: previousPath },
    });

    return Response.json({ ok: true, workspaceId: id });
  } catch (error) {
    return brandingError(error);
  }
}
