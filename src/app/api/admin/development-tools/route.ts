import { createClient as createAuthClient } from "@supabase/supabase-js";
import {
  adminErrorResponse,
  adminProductError,
  requirePlatformAdmin,
} from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { addSnapshotChecksum, hashJson, type WorkspaceSnapshot } from "@/lib/server/workspace-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCOPES = new Set(["customers", "products", "services", "sales", "workspace"]);

function requiredUuid(value: unknown, label: string) {
  const result = String(value ?? "").trim();
  if (!UUID.test(result)) throw adminProductError("INVALID_DEVELOPMENT_TOOL_INPUT", 400, `${label} is invalid.`);
  return result;
}

function requiredScope(value: unknown) {
  const result = String(value ?? "").trim().toLowerCase();
  if (!SCOPES.has(result)) throw adminProductError("INVALID_RESET_SCOPE", 400, "Choose a supported reset scope.");
  return result;
}

function requireFounder(role: "founder" | "support") {
  if (role !== "founder") {
    throw adminProductError("FOUNDER_REQUIRED", 403, "Development tools are restricted to active Founders.");
  }
}

async function verifyFounderPassword(userId: string, signedInEmail: string, enteredEmail: unknown, enteredPassword: unknown) {
  const actualEmail = signedInEmail.trim().toLowerCase();
  const email = String(enteredEmail ?? "").trim().toLowerCase();
  const password = String(enteredPassword ?? "");
  if (!actualEmail || email !== actualEmail) {
    throw adminProductError("DEVELOPMENT_TOOL_REAUTH_FAILED", 403, "Enter the exact signed-in Founder email.");
  }
  if (!password || password.length > 256) {
    throw adminProductError("DEVELOPMENT_TOOL_REAUTH_FAILED", 403, "Enter your current password.");
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("NOT_CONFIGURED");
  const verifier = createAuthClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await verifier.auth.signInWithPassword({ email: actualEmail, password });
  if (error || data.user?.id !== userId) {
    throw adminProductError("DEVELOPMENT_TOOL_REAUTH_FAILED", 403, "Password verification failed.");
  }
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "workspace";
}

export async function GET(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    requireFounder(identity.role);
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const url = new URL(request.url);
    const workspaceId = requiredUuid(url.searchParams.get("workspaceId"), "Workspace");
    const snapshotId = url.searchParams.get("snapshotId");
    const now = new Date().toISOString();
    const cleanup = await admin.from("founder_development_snapshots").delete().lt("expires_at", now);
    if (cleanup.error) throw cleanup.error;

    if (snapshotId) {
      const id = requiredUuid(snapshotId, "Snapshot");
      const { data, error } = await admin
        .from("founder_development_snapshots")
        .select("id,target_workspace_id,scope,snapshot,created_at")
        .eq("id", id)
        .eq("target_workspace_id", workspaceId)
        .gt("expires_at", now)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw adminProductError("SNAPSHOT_NOT_FOUND", 404, "That recovery snapshot could not be found.");
      const envelope = addSnapshotChecksum(data.snapshot as WorkspaceSnapshot);
      const filename = `${safeFilename(envelope.workspace.name)}-${data.scope}-${String(data.created_at).slice(0, 10)}.bdb-snapshot.json`;
      return new Response(`${JSON.stringify(envelope, null, 2)}\n`, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Cache-Control": "no-store, max-age=0",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }

    const [designation, snapshots] = await Promise.all([
      admin.from("founder_development_workspaces").select("target_workspace_id,reason,enabled_at,enabled_by").eq("target_workspace_id", workspaceId).maybeSingle(),
      admin.from("founder_development_snapshots").select("id,scope,checksum,created_at,expires_at,created_by").eq("target_workspace_id", workspaceId).gt("expires_at", now).order("created_at", { ascending: false }).limit(10),
    ]);
    if (designation.error) throw designation.error;
    if (snapshots.error) throw snapshots.error;
    return Response.json({ designation: designation.data, snapshots: snapshots.data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    requireFounder(identity.role);
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as Record<string, unknown>;
    const action = String(body.action ?? "");
    const workspaceId = requiredUuid(body.workspaceId, "Workspace");

    if (action === "preview") {
      const scope = requiredScope(body.scope);
      const { data, error } = await admin.rpc("founder_development_reset_preview", {
        target_workspace_id: workspaceId,
        target_actor_user_id: identity.userId,
        target_scope: scope,
      });
      if (error) throw error;
      return Response.json({ ok: true, preview: data });
    }

    await verifyFounderPassword(identity.userId, identity.email, body.email, body.password);

    if (action === "set-designation") {
      const enabled = body.enabled === true;
      const expectedName = String(body.expectedName ?? "");
      const confirmation = String(body.confirmation ?? "");
      const requiredConfirmation = `${enabled ? "ENABLE" : "DISABLE"} DEVELOPMENT ${expectedName}`;
      if (!expectedName || confirmation !== requiredConfirmation) {
        throw adminProductError("DEVELOPMENT_CONFIRMATION_REQUIRED", 400, `Type ${requiredConfirmation} exactly.`);
      }
      const { data, error } = await admin.rpc("founder_set_development_workspace", {
        target_workspace_id: workspaceId,
        target_actor_user_id: identity.userId,
        target_enabled: enabled,
        target_expected_name: expectedName,
        target_reason: String(body.reason ?? ""),
        target_occurred_at: new Date().toISOString(),
      });
      if (error) throw error;
      return Response.json({ ok: true, designation: data });
    }

    if (action === "reset") {
      const scope = requiredScope(body.scope);
      const expectedName = String(body.expectedName ?? "");
      const confirmation = String(body.confirmation ?? "");
      const requiredConfirmation = `RESET ${scope.toUpperCase()} IN ${expectedName}`;
      const idempotencyKey = String(body.idempotencyKey ?? "").trim();
      if (!expectedName || confirmation !== requiredConfirmation) {
        throw adminProductError("RESET_CONFIRMATION_REQUIRED", 400, `Type ${requiredConfirmation} exactly.`);
      }
      if (idempotencyKey.length < 8 || idempotencyKey.length > 128) {
        throw adminProductError("RESET_RETRY_IDENTITY_REQUIRED", 400, "A valid reset retry identity is required.");
      }
      const requestHash = hashJson({ workspaceId, scope, expectedName });
      const { data, error } = await admin.rpc("founder_reset_development_workspace", {
        target_workspace_id: workspaceId,
        target_actor_user_id: identity.userId,
        target_scope: scope,
        target_expected_name: expectedName,
        target_idempotency_key: idempotencyKey,
        target_request_hash: requestHash,
        target_occurred_at: new Date().toISOString(),
      });
      if (error) throw error;
      return Response.json({ ok: true, result: data });
    }

    throw adminProductError("UNSUPPORTED_DEVELOPMENT_TOOL_ACTION", 400, "That development tool action is not supported.");
  } catch (error) {
    return adminErrorResponse(error);
  }
}
