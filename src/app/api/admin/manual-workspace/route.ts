import type { User } from "@supabase/supabase-js";
import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { manualOwnerEmail, normaliseManualLoginId, validateTemporaryPassword } from "@/lib/auth/manual-provisioning";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

function cleanSlug(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

async function listUsers(admin: AdminClient) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return data.users;
}

async function findUserByEmail(admin: AdminClient, email: string): Promise<User | undefined> {
  const users = await listUsers(admin);
  return users.find((user) => user.email?.toLowerCase() === email.toLowerCase());
}

export async function POST(request: Request) {
  let createdAuthUser: User | undefined;
  let workspaceId = "";

  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");

    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const legalName = String(body.legalName ?? "").trim() || null;
    const slug = cleanSlug(body.slug);
    const ownerName = String(body.ownerName ?? "").trim();
    const loginId = normaliseManualLoginId(body.loginId);
    const temporaryPassword = String(body.temporaryPassword ?? "");
    const planId = String(body.planId ?? "");
    const selectedFeatures = Array.isArray(body.features) ? body.features.map(String) : null;
    const passwordError = validateTemporaryPassword(temporaryPassword);

    if (!name || slug.length < 3 || ownerName.length < 2 || loginId.length < 3 || !planId || passwordError) {
      return Response.json(
        { error: passwordError ?? "Business name, slug, owner name, login ID and plan are required." },
        { status: 400 },
      );
    }

    const { data: plan } = await admin
      .from("plans")
      .select("id")
      .eq("id", planId)
      .eq("is_active", true)
      .maybeSingle();
    if (!plan) return Response.json({ error: "Choose an active plan." }, { status: 400 });

    const loginEmail = manualOwnerEmail(slug, loginId);
    const existing = await findUserByEmail(admin, loginEmail);
    if (existing) {
      return Response.json(
        { error: "That manual login ID is already in use for this workspace." },
        { status: 409 },
      );
    }

    workspaceId = crypto.randomUUID();
    const now = new Date().toISOString();

    const { error: workspaceError } = await admin.from("workspaces").insert({
      id: workspaceId,
      name,
      legal_name: legalName,
      slug,
      status: "active",
      plan_id: planId,
    });
    if (workspaceError) throw workspaceError;

    const createUser = await admin.auth.admin.createUser({
      email: loginEmail,
      password: temporaryPassword,
      email_confirm: true,
      user_metadata: {
        full_name: ownerName,
        workspace_id: workspaceId,
        access_profile: "owner",
        provisioning_method: "manual",
      },
      app_metadata: {
        provisioning_method: "manual",
      },
    });
    if (createUser.error || !createUser.data.user) {
      throw createUser.error ?? new Error("Could not create the manual owner account.");
    }
    createdAuthUser = createUser.data.user;

    const setupResults = await Promise.all([
      admin.from("profiles").upsert({
        id: createdAuthUser.id,
        full_name: ownerName,
        is_active: true,
        must_change_password: true,
      }, { onConflict: "id" }),
      admin.from("workspace_memberships").upsert({
        workspace_id: workspaceId,
        user_id: createdAuthUser.id,
        role: "owner",
        access_profile: "owner",
        status: "active",
        invited_by: identity.userId,
        joined_at: now,
        invitation_last_sent_at: null,
        invitation_expires_at: null,
      }, { onConflict: "workspace_id,user_id" }),
      admin.from("workspace_settings").insert({
        workspace_id: workspaceId,
        owner_name: ownerName,
        email: loginEmail,
      }),
      admin.from("workspace_themes").insert({
        workspace_id: workspaceId,
        preset: "obsidian-gold",
        mode: "dark",
        accent_color: "#d3a84b",
        font_family: "manrope",
        text_scale: 1,
        density: "comfortable",
      }),
    ]);
    const setupFailure = setupResults.find((result) => result.error);
    if (setupFailure?.error) throw setupFailure.error;

    if (selectedFeatures) {
      const { data: allFeatures, error: featureError } = await admin
        .from("features")
        .select("key")
        .eq("is_active", true);
      if (featureError) throw featureError;
      const selected = new Set(selectedFeatures);
      const { error: overrideError } = await admin.from("workspace_feature_overrides").upsert(
        (allFeatures ?? []).map((feature) => ({
          workspace_id: workspaceId,
          feature_key: feature.key,
          enabled: selected.has(feature.key),
          reason: "Selected during manual client provisioning",
          starts_at: now,
          created_by: identity.userId,
        })),
        { onConflict: "workspace_id,feature_key" },
      );
      if (overrideError) throw overrideError;
    }

    const { error: auditError } = await admin.from("audit_logs").insert({
      actor_user_id: identity.userId,
      workspace_id: workspaceId,
      action: "workspace.manually_provisioned",
      entity_type: "workspace",
      entity_id: workspaceId,
      metadata: {
        name,
        legal_name: legalName,
        slug,
        owner_name: ownerName,
        manual_login: loginEmail,
        plan_id: planId,
        selected_features: selectedFeatures,
        email_delivery_used: false,
        password_change_required: true,
      },
    });
    if (auditError) throw auditError;

    return Response.json({
      ok: true,
      workspaceId,
      loginId: loginEmail,
      accountStatus: "active",
      activationMethod: "manual",
      emailSent: false,
      mustChangePassword: true,
    });
  } catch (error) {
    const admin = createAdminClient();
    if (admin && workspaceId) await admin.from("workspaces").delete().eq("id", workspaceId);
    if (admin && createdAuthUser) await admin.auth.admin.deleteUser(createdAuthUser.id);
    return adminErrorResponse(error);
  }
}
