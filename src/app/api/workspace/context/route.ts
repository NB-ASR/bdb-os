import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

async function identity() {
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) throw new Error("NOT_CONFIGURED");
  const { data: claims, error } = await supabase.auth.getClaims();
  const userId = String(claims?.claims?.sub ?? "");
  if (error || !userId) throw new Error("UNAUTHENTICATED");
  return { supabase, admin, userId };
}

function failure(error: unknown) {
  const code = error instanceof Error ? error.message : "REQUEST_FAILED";
  const status = code === "NOT_CONFIGURED" ? 503 : code === "UNAUTHENTICATED" ? 401 : code === "FORBIDDEN" ? 403 : 500;
  const message = code === "FORBIDDEN"
    ? "This business is not linked to your current company or you do not have active access."
    : code === "NOT_CONFIGURED"
      ? "Cloud workspace switching is not configured."
      : code === "UNAUTHENTICATED"
        ? "Sign in to continue."
        : "The business context could not be loaded.";
  return Response.json({ error: message, code }, { status });
}

type LinkedWorkspace = {
  workspace_id: string;
  workspace_name?: string;
  is_active?: boolean;
};
type EffectiveFeature = { feature_key: string; enabled: boolean };

export async function GET() {
  try {
    const { supabase, admin, userId } = await identity();
    const { data, error } = await supabase.rpc("get_my_linked_workspaces");
    if (error) throw error;
    const workspaces = (data ?? []) as LinkedWorkspace[];
    const current = workspaces.find((workspace) => workspace.is_active) ?? workspaces[0];

    const { data: profile, error: profileLookupError } = await admin
      .from("profiles")
      .select("active_workspace_id,full_name")
      .eq("id", userId)
      .maybeSingle();
    if (profileLookupError) throw profileLookupError;

    if (current && !profile?.active_workspace_id) {
      const { error: profileError } = await admin
        .from("profiles")
        .update({ active_workspace_id: current.workspace_id })
        .eq("id", userId);
      if (profileError) throw profileError;
    }

    let features: Record<string, boolean> = {};
    let clientLogoUrl: string | null = null;
    if (current) {
      const featureResult = await supabase.rpc("get_effective_features", {
        target_workspace_id: current.workspace_id,
      });
      if (featureResult.error) throw featureResult.error;
      features = Object.fromEntries(
        ((featureResult.data ?? []) as EffectiveFeature[])
          .map((feature) => [feature.feature_key, feature.enabled]),
      );

      if (features.custom_branding) {
        const { data: theme, error: themeError } = await admin
          .from("workspace_themes")
          .select("client_logo_path")
          .eq("workspace_id", current.workspace_id)
          .maybeSingle();
        if (themeError) throw themeError;
        const logoPath = theme?.client_logo_path ? String(theme.client_logo_path) : "";
        if (logoPath) {
          const signed = await admin.storage.from("workspace-assets").createSignedUrl(logoPath, 3600);
          if (signed.error) throw signed.error;
          clientLogoUrl = signed.data?.signedUrl ?? null;
        }
      }
    }

    const response = Response.json({
      workspaces,
      currentWorkspaceId: current?.workspace_id ?? null,
      currentWorkspaceName: String(current?.workspace_name ?? ""),
      currentUser: {
        id: userId,
        fullName: String(profile?.full_name ?? "").trim(),
      },
      features,
      branding: {
        enabled: Boolean(features.custom_branding),
        logoUrl: clientLogoUrl,
      },
      supportAccess: false,
      supportAccessMode: null,
    });
    if (current) {
      response.headers.append(
        "Set-Cookie",
        `bdb-workspace=${encodeURIComponent(current.workspace_id)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
      );
    }
    return response;
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { supabase, admin, userId } = await identity();
    const body = (await request.json()) as { workspaceId?: string };
    const targetWorkspaceId = String(body.workspaceId ?? "");
    if (!targetWorkspaceId) return Response.json({ error: "Choose a business." }, { status: 400 });

    // Use the database-owned allowlist instead of trusting a cookie or performing
    // a second, slightly different linkage calculation in application code.
    const { data, error } = await supabase.rpc("get_my_linked_workspaces");
    if (error) throw error;
    const workspaces = (data ?? []) as LinkedWorkspace[];
    const target = workspaces.find((workspace) => workspace.workspace_id === targetWorkspaceId);
    if (!target) throw new Error("FORBIDDEN");
    const current = workspaces.find((workspace) => workspace.is_active) ?? workspaces[0];
    const currentWorkspaceId = current?.workspace_id ?? null;

    const { error: profileError } = await admin
      .from("profiles")
      .update({ active_workspace_id: targetWorkspaceId })
      .eq("id", userId);
    if (profileError) throw profileError;

    await admin.from("audit_logs").insert({
      workspace_id: targetWorkspaceId,
      actor_user_id: userId,
      action: "workspace.context_switched",
      entity_type: "workspace",
      entity_id: targetWorkspaceId,
      metadata: { previous_workspace_id: currentWorkspaceId },
    });

    const response = Response.json({ ok: true, workspaceId: targetWorkspaceId });
    response.headers.append(
      "Set-Cookie",
      `bdb-workspace=${encodeURIComponent(targetWorkspaceId)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV === "production" ? "; Secure" : ""}`,
    );
    return response;
  } catch (error) {
    return failure(error);
  }
}
