import { createAdminClient } from "@/lib/supabase/admin";
import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";

async function dashboard(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
) {
  const [
    workspaces,
    plans,
    features,
    planFeatures,
    overrides,
    subscriptions,
    contracts,
    memberships,
    audit,
  ] = await Promise.all([
    admin
      .from("workspaces")
      .select("*")
      .order("created_at", { ascending: false }),
    admin.from("plans").select("*").order("sort_order"),
    admin.from("features").select("*").order("sort_order"),
    admin.from("plan_features").select("*"),
    admin.from("workspace_feature_overrides").select("*"),
    admin.from("subscriptions").select("*"),
    admin.from("contracts").select("*"),
    admin
      .from("workspace_memberships")
      .select("workspace_id,user_id,role,status"),
    admin
      .from("audit_logs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  const failed = [
    workspaces,
    plans,
    features,
    planFeatures,
    overrides,
    subscriptions,
    contracts,
    memberships,
    audit,
  ].find((result) => result.error);
  if (failed?.error) throw failed.error;
  return {
    workspaces: workspaces.data,
    plans: plans.data,
    features: features.data,
    planFeatures: planFeatures.data,
    overrides: overrides.data,
    subscriptions: subscriptions.data,
    contracts: contracts.data,
    memberships: memberships.data,
    audit: audit.data,
  };
}

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    return Response.json(await dashboard(admin));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as {
      action: string;
      [key: string]: unknown;
    };
    if (body.action !== "create-workspace")
      return Response.json({ error: "Unsupported action" }, { status: 400 });
    const name = String(body.name ?? "").trim();
    const slug = String(body.slug ?? "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]/g, "-");
    const ownerEmail = String(body.ownerEmail ?? "")
      .trim()
      .toLowerCase();
    const planId = String(body.planId ?? "");
    if (!name || !slug || !ownerEmail || !planId)
      return Response.json(
        { error: "Name, slug, owner email and plan are required." },
        { status: 400 },
      );

    const workspaceId = crypto.randomUUID();
    const { error: workspaceError } = await admin
      .from("workspaces")
      .insert({
        id: workspaceId,
        name,
        slug,
        status: "trial",
        plan_id: planId,
      });
    if (workspaceError) throw workspaceError;
    const invite = await admin.auth.admin.inviteUserByEmail(ownerEmail, {
      data: { workspace_id: workspaceId, workspace_role: "owner" },
      redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin}/auth/callback?next=/workspace`,
    });
    if (invite.error || !invite.data.user) {
      await admin.from("workspaces").delete().eq("id", workspaceId);
      throw invite.error ?? new Error("Could not invite owner");
    }
    await Promise.all([
      admin
        .from("workspace_memberships")
        .insert({
          workspace_id: workspaceId,
          user_id: invite.data.user.id,
          role: "owner",
          status: "invited",
          invited_by: identity.userId,
        }),
      admin
        .from("workspace_settings")
        .insert({
          workspace_id: workspaceId,
          owner_name: ownerEmail.split("@")[0],
          email: ownerEmail,
        }),
      admin
        .from("workspace_themes")
        .insert({
          workspace_id: workspaceId,
          preset: "obsidian-gold",
          mode: "dark",
          accent_color: "#d3a84b",
          font_family: "manrope",
          text_scale: 1,
          density: "comfortable",
        }),
      admin
        .from("audit_logs")
        .insert({
          actor_user_id: identity.userId,
          workspace_id: workspaceId,
          action: "workspace.created",
          entity_type: "workspace",
          entity_id: workspaceId,
          metadata: { name, slug, owner_email: ownerEmail, plan_id: planId },
        }),
    ]);
    return Response.json({ ok: true, workspaceId });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as {
      action: string;
      workspaceId?: string;
      planId?: string;
      featureKey?: string;
      enabled?: boolean;
      status?: string;
      reason?: string;
    };
    if (
      body.action === "feature-override" &&
      body.workspaceId &&
      body.featureKey
    ) {
      const { error } = await admin
        .from("workspace_feature_overrides")
        .upsert(
          {
            workspace_id: body.workspaceId,
            feature_key: body.featureKey,
            enabled: Boolean(body.enabled),
            reason: body.reason || "Founder override",
            created_by: identity.userId,
            starts_at: new Date().toISOString(),
          },
          { onConflict: "workspace_id,feature_key" },
        );
      if (error) throw error;
    } else if (
      body.action === "plan-feature" &&
      body.planId &&
      body.featureKey
    ) {
      const { error } = await admin
        .from("plan_features")
        .upsert(
          {
            plan_id: body.planId,
            feature_key: body.featureKey,
            enabled: Boolean(body.enabled),
          },
          { onConflict: "plan_id,feature_key" },
        );
      if (error) throw error;
    } else if (
      body.action === "workspace-plan" &&
      body.workspaceId &&
      body.planId
    ) {
      const { error } = await admin
        .from("workspaces")
        .update({ plan_id: body.planId })
        .eq("id", body.workspaceId);
      if (error) throw error;
    } else if (
      body.action === "workspace-status" &&
      body.workspaceId &&
      body.status
    ) {
      const allowed = ["trial", "active", "suspended", "cancelled"];
      if (!allowed.includes(body.status))
        return Response.json({ error: "Invalid status" }, { status: 400 });
      const { error } = await admin
        .from("workspaces")
        .update({ status: body.status })
        .eq("id", body.workspaceId);
      if (error) throw error;
    } else if (
      body.action === "support-access" &&
      body.workspaceId &&
      body.reason?.trim()
    ) {
      // The audit insert below is the access grant. Data remains inside the
      // founder console instead of creating an unlogged impersonation session.
    } else return Response.json({ error: "Invalid action" }, { status: 400 });
    await admin
      .from("audit_logs")
      .insert({
        actor_user_id: identity.userId,
        workspace_id: body.workspaceId ?? null,
        action: `admin.${body.action}`,
        entity_type: body.featureKey ? "feature" : "workspace",
        entity_id: body.featureKey ?? body.workspaceId ?? body.planId ?? null,
        metadata: body,
      });
    return Response.json({ ok: true });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
