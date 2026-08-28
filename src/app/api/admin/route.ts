import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  AdminProductError,
  adminErrorResponse,
  adminProductError,
  requirePlatformAdmin,
} from "@/lib/admin-auth";
import {
  cleanBusinessSlug,
  firstAvailableSlug,
  invitationCooldownSeconds,
} from "@/lib/founder-admin";
import {
  attemptFounderInvitationDelivery,
  ensureFounderManagedUser,
  listFounderAuthUsers,
} from "@/lib/server/founder-admin-invitations";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;
type AuditRow = {
  id: number;
  actor_user_id: string | null;
  workspace_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};
type WorkspaceRow = {
  id: string;
  created_at: string;
  [key: string]: unknown;
};

const WORKSPACE_CREATION_ACTIONS = new Set(["workspace.created", "workspace.manually_provisioned"]);
const NON_MODIFYING_FOUNDER_ACTIONS = new Set(["platform.founder_workspace_ready", "admin.support-access"]);

async function writeAudit(admin: AdminClient, record: Record<string, unknown>) {
  const { error } = await admin.from("audit_logs").insert(record);
  if (error) throw error;
}

function actorDetails(
  userId: string | null,
  profilesById: Map<string, string>,
  usersById: Map<string, User>,
) {
  if (!userId) return { name: null, email: null };
  const user = usersById.get(userId);
  const metadataName = typeof user?.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : "";
  return {
    name: profilesById.get(userId) || metadataName || user?.email || null,
    email: user?.email ?? null,
  };
}

function enrichAudit(
  row: AuditRow,
  profilesById: Map<string, string>,
  usersById: Map<string, User>,
  platformAdminIds: Set<string>,
) {
  const actor = actorDetails(row.actor_user_id, profilesById, usersById);
  return {
    ...row,
    metadata: row.metadata ?? {},
    actor_name: actor.name,
    actor_email: actor.email,
    actor_is_platform_admin: Boolean(row.actor_user_id && platformAdminIds.has(row.actor_user_id)),
  };
}

async function dashboard(admin: AdminClient) {
  const [
    workspaces,
    plans,
    features,
    planFeatures,
    overrides,
    templates,
    subscriptions,
    contracts,
    memberships,
    groups,
    groupLinks,
    recentAudit,
    workspaceAudit,
    profiles,
    platformAdmins,
    users,
  ] = await Promise.all([
    admin.from("workspaces").select("*").order("created_at", { ascending: false }),
    admin.from("plans").select("*").order("sort_order"),
    admin.from("features").select("*").order("sort_order"),
    admin.from("plan_features").select("*"),
    admin.from("workspace_feature_overrides").select("*"),
    admin.from("workspace_templates").select("id,code,name,description,plan_id,version,is_active,is_default").order("is_default", { ascending: false }).order("name"),
    admin.from("subscriptions").select("*"),
    admin.from("contracts").select("*"),
    admin
      .from("workspace_memberships")
      .select("workspace_id,user_id,role,access_profile,status,created_at,joined_at,invitation_expires_at,invitation_last_sent_at,invitation_delivery_status,invitation_delivery_attempted_at,invitation_delivery_error_code,profiles(full_name)"),
    admin.from("business_groups").select("*").order("name"),
    admin.from("business_group_workspaces").select("group_id,workspace_id,created_at"),
    admin.from("audit_logs").select("*").order("created_at", { ascending: false }).limit(250),
    admin.from("audit_logs").select("*").not("workspace_id", "is", null).order("created_at", { ascending: false }).limit(2000),
    admin.from("profiles").select("id,full_name"),
    admin.from("platform_admins").select("user_id,role,active"),
    listFounderAuthUsers(admin),
  ]);
  const results = [
    workspaces,
    plans,
    features,
    planFeatures,
    overrides,
    templates,
    subscriptions,
    contracts,
    memberships,
    groups,
    groupLinks,
    recentAudit,
    workspaceAudit,
    profiles,
    platformAdmins,
  ];
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;

  const usersById = new Map(users.map((user) => [user.id, user]));
  const profilesById = new Map(
    (profiles.data ?? [])
      .filter((profile) => profile.id && profile.full_name)
      .map((profile) => [String(profile.id), String(profile.full_name).trim()]),
  );
  const platformAdminIds = new Set(
    (platformAdmins.data ?? [])
      .filter((record) => record.active)
      .map((record) => String(record.user_id)),
  );
  const enrichedRecentAudit = ((recentAudit.data ?? []) as AuditRow[]).map((row) =>
    enrichAudit(row, profilesById, usersById, platformAdminIds),
  );
  const founderWorkspaceAudit = ((workspaceAudit.data ?? []) as AuditRow[])
    .filter((row) => Boolean(row.actor_user_id && platformAdminIds.has(row.actor_user_id)))
    .map((row) => enrichAudit(row, profilesById, usersById, platformAdminIds));

  const workspaceActivity = Object.fromEntries(
    ((workspaces.data ?? []) as WorkspaceRow[]).map((workspace) => {
      const rows = founderWorkspaceAudit.filter((row) => row.workspace_id === workspace.id);
      const creator = [...rows]
        .reverse()
        .find((row) => WORKSPACE_CREATION_ACTIONS.has(row.action));
      const lastModified = rows.find((row) => !NON_MODIFYING_FOUNDER_ACTIONS.has(row.action)) ?? creator ?? null;
      return [
        workspace.id,
        {
          workspace_id: workspace.id,
          created_at: creator?.created_at ?? workspace.created_at,
          created_by_user_id: creator?.actor_user_id ?? null,
          created_by_name: creator?.actor_name ?? null,
          created_by_email: creator?.actor_email ?? null,
          last_modified_at: lastModified?.created_at ?? null,
          last_modified_by_user_id: lastModified?.actor_user_id ?? null,
          last_modified_by_name: lastModified?.actor_name ?? null,
          last_modified_by_email: lastModified?.actor_email ?? null,
          last_action: lastModified?.action ?? null,
        },
      ];
    }),
  );

  const auditCursor = enrichedRecentAudit.find((row) => row.actor_is_platform_admin)?.id ?? 0;

  return {
    workspaces: workspaces.data ?? [],
    plans: plans.data ?? [],
    features: features.data ?? [],
    planFeatures: planFeatures.data ?? [],
    overrides: overrides.data ?? [],
    templates: templates.data ?? [],
    subscriptions: subscriptions.data ?? [],
    contracts: contracts.data ?? [],
    memberships: (memberships.data ?? []).map((membership) => ({
      ...membership,
      email: usersById.get(membership.user_id)?.email ?? "",
    })),
    accounts: users.map((user) => ({
      id: user.id,
      email: user.email ?? "",
      full_name: profilesById.get(user.id)
        ?? (typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name.trim() : ""),
      profile_full_name: profilesById.get(user.id) ?? "",
      auth_full_name: typeof user.user_metadata?.full_name === "string"
        ? user.user_metadata.full_name.trim()
        : "",
      name_consistent: Boolean(
        profilesById.get(user.id)
        && typeof user.user_metadata?.full_name === "string"
        && profilesById.get(user.id)?.trim() === user.user_metadata.full_name.trim(),
      ),
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at ?? null,
      email_confirmed_at: user.email_confirmed_at ?? null,
      banned_until: user.banned_until ?? null,
      is_platform_admin: platformAdminIds.has(user.id),
    })),
    groups: groups.data ?? [],
    groupLinks: groupLinks.data ?? [],
    audit: enrichedRecentAudit,
    workspaceActivity,
    auditCursor,
  };
}

function validEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function availableWorkspaceSlug(
  admin: AdminClient,
  base: string,
  excludeWorkspaceId?: string,
) {
  let query = admin.from("workspaces").select("id,slug");
  if (excludeWorkspaceId) query = query.neq("id", excludeWorkspaceId);
  const { data, error } = await query;
  if (error) throw error;
  return firstAvailableSlug(base, (data ?? []).map((workspace) => String(workspace.slug)));
}

export async function GET() {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    return Response.json(
      { ...(await dashboard(admin)), actorUserId: identity.userId },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as { action?: string; [key: string]: unknown };

    if (body.action === "workspace-deletion-preview") {
      const workspaceId = String(body.workspaceId ?? "");
      if (!workspaceId) {
        throw adminProductError("WORKSPACE_REQUIRED", 400, "Choose a business to review for deletion.");
      }
      const { data: workspace, error: workspaceError } = await admin
        .from("workspaces")
        .select("id,name")
        .eq("id", workspaceId)
        .maybeSingle();
      if (workspaceError) throw workspaceError;
      if (!workspace) {
        throw adminProductError("WORKSPACE_NOT_FOUND", 404, "That business could not be found.");
      }
      const { data: preview, error: previewError } = await admin.rpc(
        "founder_workspace_deletion_preview",
        { target_workspace_id: workspaceId },
      );
      if (previewError) throw previewError;
      return Response.json({ ok: true, workspace, preview });
    }

    if (body.action === "create-group") {
      const name = String(body.name ?? "").trim();
      const slug = cleanBusinessSlug(body.slug || name);
      if (name.length < 2 || slug.length < 3) {
        throw adminProductError("INVALID_GROUP", 400, "Enter a valid group name and address.");
      }
      const { data, error } = await admin
        .from("business_groups")
        .insert({ name, slug, created_by: identity.userId })
        .select("id")
        .single();
      if (error) throw error;
      await writeAudit(admin, {
        actor_user_id: identity.userId,
        action: "business_group.created",
        entity_type: "business_group",
        entity_id: data.id,
        metadata: { name, slug },
      });
      return Response.json({ ok: true, groupId: data.id });
    }

    if (body.action !== "create-workspace") {
      throw adminProductError("UNSUPPORTED_ACTION", 400, "That Founder Admin action is not supported.");
    }

    const name = String(body.name ?? "").trim();
    const legalName = String(body.legalName ?? "").trim() || null;
    const requestedSlug = String(body.slug ?? "").trim();
    const slugBase = cleanBusinessSlug(requestedSlug || name);
    const ownerName = String(body.ownerName ?? "").trim();
    const ownerEmail = String(body.ownerEmail ?? "").trim().toLowerCase();
    const templateId = String(body.templateId ?? "");
    if (name.length < 2 || slugBase.length < 3 || ownerName.length < 2 || !validEmail(ownerEmail) || !templateId) {
      throw adminProductError(
        "INVALID_WORKSPACE",
        400,
        "Business name, owner name, valid owner email and an active business template are required.",
      );
    }

    const slug = await availableWorkspaceSlug(admin, slugBase);
    if (requestedSlug && slug !== slugBase) {
      throw adminProductError(
        "DUPLICATE_WORKSPACE_SLUG",
        409,
        "That workspace address is already in use.",
        { suggestedSlug: slug },
      );
    }

    const { data: template, error: templateError } = await admin
      .from("workspace_templates")
      .select("id,code,name,version,plan_id")
      .eq("id", templateId)
      .eq("is_active", true)
      .maybeSingle();
    if (templateError) throw templateError;
    if (!template) {
      throw adminProductError("INVALID_TEMPLATE", 400, "Choose an active business template.");
    }

    const workspaceId = crypto.randomUUID();
    let setupComplete = false;
    let createdAuthUserId: string | null = null;
    try {
      const { error: workspaceError } = await admin.from("workspaces").insert({
        id: workspaceId,
        name,
        legal_name: legalName,
        slug,
        status: "trial",
      });
      if (workspaceError) throw workspaceError;

      const { error: applyTemplateError } = await admin.rpc("apply_workspace_template", {
        target_workspace_id: workspaceId,
        target_template_id: templateId,
        target_actor_user_id: identity.userId,
        target_owner_name: ownerName,
        target_owner_email: ownerEmail,
      });
      if (applyTemplateError) throw applyTemplateError;

      const managedUser = await ensureFounderManagedUser(admin, ownerEmail, ownerName);
      if (managedUser.created) createdAuthUserId = managedUser.user.id;
      const { error: membershipError } = await admin
        .from("workspace_memberships")
        .insert({
          workspace_id: workspaceId,
          user_id: managedUser.user.id,
          role: "owner",
          access_profile: "owner",
          status: "invited",
          invited_by: identity.userId,
          invitation_delivery_status: "pending",
          invitation_delivery_attempted_at: null,
          invitation_last_sent_at: null,
          invitation_expires_at: null,
      });
      if (membershipError) throw membershipError;

      await writeAudit(admin, {
        actor_user_id: identity.userId,
        workspace_id: workspaceId,
        action: "workspace.created",
        entity_type: "workspace",
        entity_id: workspaceId,
        metadata: {
          name,
          legal_name: legalName,
          slug,
          owner_name: ownerName,
          owner_email: ownerEmail,
          template_id: template.id,
          template_code: template.code,
          template_version: template.version,
          plan_id: template.plan_id,
          previous: null,
          new: { name, legal_name: legalName, slug, status: "trial" },
          invitation: { status: "pending" },
        },
      });
      setupComplete = true;

      let invitation: Record<string, unknown>;
      let deliveryMessage: string;
      try {
        invitation = await attemptFounderInvitationDelivery(admin, {
          workspaceId,
          userId: managedUser.user.id,
          email: ownerEmail,
          requestUrl: request.url,
        });
        deliveryMessage = `${name} was created and the Owner invitation was sent to ${ownerEmail}.`;
      } catch (deliveryError) {
        if (!(deliveryError instanceof AdminProductError)) throw deliveryError;
        invitation = {
          status: "failed",
          code: deliveryError.code,
          ...deliveryError.details,
        };
        deliveryMessage = `${name} was created, but the Owner invitation was not sent. ${deliveryError.publicMessage}`;
      }

      await writeAudit(admin, {
        actor_user_id: identity.userId,
        workspace_id: workspaceId,
        action: invitation.status === "sent"
          ? "admin.owner-invitation-sent"
          : "admin.owner-invitation-failed",
        entity_type: "membership",
        entity_id: managedUser.user.id,
        metadata: {
          previous: { invitation_status: "pending" },
          new: invitation,
          email: ownerEmail,
        },
      }).catch((auditError) => {
        console.error("Founder Admin invitation audit failed after durable provisioning", auditError);
      });
      return Response.json({
        ok: true,
        workspaceId,
        slug,
        templateId: template.id,
        templateVersion: template.version,
        invitation,
        message: deliveryMessage,
      }, { status: 201 });
    } catch (error) {
      if (setupComplete) throw error;
      await admin.from("workspaces").delete().eq("id", workspaceId);
      if (createdAuthUserId) {
        const { count } = await admin
          .from("workspace_memberships")
          .select("workspace_id", { count: "exact", head: true })
          .eq("user_id", createdAuthUserId);
        if ((count ?? 0) === 0) await admin.auth.admin.deleteUser(createdAuthUserId);
      }
      throw error;
    }
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
      action?: string;
      workspaceId?: string;
      planId?: string;
      featureKey?: string;
      enabled?: boolean;
      status?: string;
      reason?: string;
      groupId?: string;
      userId?: string;
      name?: string;
      legalName?: string | null;
      slug?: string;
    };

    let previous: Record<string, unknown> | null = null;
    let next: Record<string, unknown> | null = null;
    let responseDetails: Record<string, unknown> = {};

    if (body.action === "workspace-profile" && body.workspaceId) {
      const name = String(body.name ?? "").trim();
      const legalName = String(body.legalName ?? "").trim() || null;
      const requestedSlug = cleanBusinessSlug(body.slug);
      if (name.length < 2 || requestedSlug.length < 3) {
        throw adminProductError(
          "INVALID_WORKSPACE",
          400,
          "Enter a valid business name and workspace address.",
        );
      }
      const { data: workspace, error: workspaceError } = await admin
        .from("workspaces")
        .select("id,name,legal_name,slug,status,plan_id")
        .eq("id", body.workspaceId)
        .maybeSingle();
      if (workspaceError) throw workspaceError;
      if (!workspace) {
        throw adminProductError("WORKSPACE_NOT_FOUND", 404, "That business could not be found.");
      }
      const availableSlug = await availableWorkspaceSlug(admin, requestedSlug, body.workspaceId);
      if (availableSlug !== requestedSlug) {
        throw adminProductError(
          "DUPLICATE_WORKSPACE_SLUG",
          409,
          "That workspace address is already in use.",
          { suggestedSlug: availableSlug },
        );
      }
      previous = {
        name: workspace.name,
        legal_name: workspace.legal_name,
        slug: workspace.slug,
      };
      next = { name, legal_name: legalName, slug: requestedSlug };
      const { error } = await admin
        .from("workspaces")
        .update(next)
        .eq("id", body.workspaceId);
      if (error) throw error;
      responseDetails = { workspace: { ...workspace, ...next } };
    } else if (body.action === "feature-override" && body.workspaceId && body.featureKey) {
      const { data: current, error: currentError } = await admin
        .from("workspace_feature_overrides")
        .select("enabled,reason")
        .eq("workspace_id", body.workspaceId)
        .eq("feature_key", body.featureKey)
        .maybeSingle();
      if (currentError) throw currentError;
      previous = current ?? null;
      next = { enabled: Boolean(body.enabled), reason: body.reason || "Founder override" };
      const { error } = await admin.from("workspace_feature_overrides").upsert({
        workspace_id: body.workspaceId,
        feature_key: body.featureKey,
        ...next,
        created_by: identity.userId,
        starts_at: new Date().toISOString(),
      }, { onConflict: "workspace_id,feature_key" });
      if (error) throw error;
    } else if (body.action === "plan-feature" && body.planId && body.featureKey) {
      const { data: current, error: currentError } = await admin
        .from("plan_features")
        .select("enabled")
        .eq("plan_id", body.planId)
        .eq("feature_key", body.featureKey)
        .maybeSingle();
      if (currentError) throw currentError;
      previous = current ?? null;
      next = { enabled: Boolean(body.enabled) };
      const { error } = await admin.from("plan_features").upsert({
        plan_id: body.planId,
        feature_key: body.featureKey,
        enabled: Boolean(body.enabled),
      }, { onConflict: "plan_id,feature_key" });
      if (error) throw error;
    } else if (body.action === "workspace-plan" && body.workspaceId && body.planId) {
      const { data: current, error: currentError } = await admin
        .from("workspaces")
        .select("plan_id")
        .eq("id", body.workspaceId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) throw adminProductError("WORKSPACE_NOT_FOUND", 404, "That business could not be found.");
      previous = { plan_id: current.plan_id };
      next = { plan_id: body.planId };
      const { error } = await admin.from("workspaces").update({ plan_id: body.planId }).eq("id", body.workspaceId);
      if (error) throw error;
    } else if (
      (body.action === "workspace-status" || body.action === "archive-workspace")
      && body.workspaceId
    ) {
      const allowed = ["trial", "active", "suspended", "cancelled"];
      const requestedStatus = body.action === "archive-workspace" ? "cancelled" : String(body.status ?? "");
      if (!allowed.includes(requestedStatus)) {
        throw adminProductError("INVALID_WORKSPACE_STATUS", 400, "Choose a valid business status.");
      }
      if (requestedStatus === "active") {
        const { count, error: ownerError } = await admin
          .from("workspace_memberships")
          .select("user_id", { count: "exact", head: true })
          .eq("workspace_id", body.workspaceId)
          .eq("access_profile", "owner")
          .eq("status", "active");
        if (ownerError) throw ownerError;
        if ((count ?? 0) < 1) {
          throw adminProductError(
            "ACTIVE_OWNER_REQUIRED",
            409,
            "Activate this business after at least one Owner has accepted their invitation.",
          );
        }
      }
      const { data: current, error: currentError } = await admin
        .from("workspaces")
        .select("status")
        .eq("id", body.workspaceId)
        .maybeSingle();
      if (currentError) throw currentError;
      if (!current) throw adminProductError("WORKSPACE_NOT_FOUND", 404, "That business could not be found.");
      previous = { status: current.status };
      next = { status: requestedStatus };
      const { error } = await admin.from("workspaces").update(next).eq("id", body.workspaceId);
      if (error) throw error;
    } else if (body.action === "link-workspace" && body.workspaceId && body.groupId) {
      const { data: current, error: currentError } = await admin
        .from("business_group_workspaces")
        .select("group_id")
        .eq("workspace_id", body.workspaceId)
        .maybeSingle();
      if (currentError) throw currentError;
      previous = current ?? null;
      next = { group_id: body.groupId };
      const removeExisting = await admin.from("business_group_workspaces").delete().eq("workspace_id", body.workspaceId);
      if (removeExisting.error) throw removeExisting.error;
      const { error } = await admin.from("business_group_workspaces").insert({
        group_id: body.groupId,
        workspace_id: body.workspaceId,
        created_by: identity.userId,
      });
      if (error) throw error;
    } else if (body.action === "unlink-workspace" && body.workspaceId) {
      const { data: current, error: currentError } = await admin
        .from("business_group_workspaces")
        .select("group_id")
        .eq("workspace_id", body.workspaceId)
        .maybeSingle();
      if (currentError) throw currentError;
      previous = current ?? null;
      next = null;
      const { error } = await admin.from("business_group_workspaces").delete().eq("workspace_id", body.workspaceId);
      if (error) throw error;
    } else if (body.action === "resend-owner-invite" && body.workspaceId) {
      const { data: membership, error: membershipError } = await admin
        .from("workspace_memberships")
        .select("user_id,status,invitation_delivery_status,invitation_delivery_attempted_at,invitation_last_sent_at,invitation_expires_at")
        .eq("workspace_id", body.workspaceId)
        .eq("role", "owner")
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (!membership) {
        throw adminProductError("INVITATION_NOT_FOUND", 404, "No Business Owner invitation was found.");
      }
      if (membership.status !== "invited") {
        throw adminProductError("INVITATION_PENDING", 409, "The Business Owner has already activated access.");
      }
      const retryAfterSeconds = invitationCooldownSeconds(membership.invitation_delivery_attempted_at);
      if (retryAfterSeconds > 0) {
        throw adminProductError(
          "INVITATION_RESEND_COOLDOWN",
          429,
          `Wait ${retryAfterSeconds} seconds before resending this invitation.`,
          { retryAfterSeconds },
        );
      }
      const users = await listFounderAuthUsers(admin);
      const email = users.find((user) => user.id === membership.user_id)?.email;
      if (!email) throw adminProductError("USER_NOT_FOUND", 404, "The invited Owner's email could not be found.");
      previous = membership;
      const delivery = await attemptFounderInvitationDelivery(admin, {
        workspaceId: body.workspaceId,
        userId: membership.user_id,
        email,
        requestUrl: request.url,
      });
      next = delivery;
      responseDetails = { invitation: delivery, message: `Invitation resent to ${email}.` };
    } else if (body.action === "support-access" && body.workspaceId && body.reason?.trim()) {
      previous = null;
      next = { reason: body.reason.trim() };
    } else {
      throw adminProductError("INVALID_ACTION", 400, "Choose a valid Founder Admin action.");
    }

    await writeAudit(admin, {
      actor_user_id: identity.userId,
      workspace_id: body.workspaceId ?? null,
      action: `admin.${body.action}`,
      entity_type: body.groupId ? "business_group" : body.featureKey ? "feature" : "workspace",
      entity_id: body.groupId ?? body.featureKey ?? body.workspaceId ?? body.planId ?? null,
      metadata: { request: body, previous, new: next },
    });
    return Response.json({ ok: true, ...responseDetails });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as { workspaceId?: string; expectedName?: string };
    const workspaceId = String(body.workspaceId ?? "");
    const expectedName = String(body.expectedName ?? "");
    if (!workspaceId || !expectedName) {
      throw adminProductError(
        "DELETION_CONFIRMATION_REQUIRED",
        400,
        "Type the exact business name to confirm permanent deletion.",
      );
    }

    const { data, error } = await admin.rpc("founder_delete_empty_workspace", {
      target_workspace_id: workspaceId,
      target_expected_name: expectedName,
      target_actor_user_id: identity.userId,
    });
    if (error) throw error;
    const result = (data ?? {}) as Record<string, unknown>;
    if (result.ok) return Response.json(result);
    if (result.code === "WORKSPACE_NOT_FOUND") {
      throw adminProductError("WORKSPACE_NOT_FOUND", 404, "That business could not be found.");
    }
    if (result.code === "CONFIRMATION_MISMATCH") {
      throw adminProductError(
        "CONFIRMATION_MISMATCH",
        400,
        "The confirmation did not exactly match the business name.",
      );
    }
    if (result.code === "DELETION_BLOCKED") {
      throw adminProductError(
        "DELETION_BLOCKED",
        409,
        "This business contains operational or financial history and cannot be permanently deleted. Archive it instead.",
        { preview: result.preview },
      );
    }
    throw new Error("UNEXPECTED_WORKSPACE_DELETION_RESULT");
  } catch (error) {
    return adminErrorResponse(error);
  }
}
