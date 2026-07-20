import { createClient } from "@supabase/supabase-js";

export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secret = process.env.SUPABASE_SECRET_KEY;
  if (!url || !secret) return null;
  return createClient(url, secret, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

type MembershipWorkspace = { status: string };

type PendingMembership = {
  workspace_id: string;
  invitation_expires_at: string | null;
  created_at: string;
  workspaces: MembershipWorkspace;
};

type ActiveMembership = {
  workspace_id: string;
  workspaces: MembershipWorkspace;
};

const AVAILABLE_WORKSPACE_STATUSES = new Set(["trial", "active"]);

export async function activatePendingMemberships(userId: string) {
  const admin = createAdminClient();
  if (!admin) throw new Error("NOT_CONFIGURED");

  const now = new Date().toISOString();
  const [pendingResult, activeResult, profileResult] = await Promise.all([
    admin
      .from("workspace_memberships")
      .select("workspace_id,invitation_expires_at,created_at,workspaces!inner(status)")
      .eq("user_id", userId)
      .eq("status", "invited")
      .order("created_at"),
    admin
      .from("workspace_memberships")
      .select("workspace_id,workspaces!inner(status)")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at"),
    admin
      .from("profiles")
      .select("active_workspace_id")
      .eq("id", userId)
      .maybeSingle(),
  ]);
  const failed = [pendingResult, activeResult, profileResult].find((result) => result.error);
  if (failed?.error) throw failed.error;

  const pending = (pendingResult.data ?? []) as unknown as PendingMembership[];
  const availablePending = pending.filter((membership) =>
    AVAILABLE_WORKSPACE_STATUSES.has(membership.workspaces.status),
  );
  const unavailableWorkspaceIds = pending
    .filter((membership) => !AVAILABLE_WORKSPACE_STATUSES.has(membership.workspaces.status))
    .map((membership) => membership.workspace_id);

  // Missing expiry is invalid. Invitation records must never outlive the Auth
  // token merely because a database timestamp was absent.
  const nonExpired = availablePending.filter(
    (membership) =>
      Boolean(membership.invitation_expires_at) && membership.invitation_expires_at! > now,
  );
  const expiredWorkspaceIds = availablePending
    .filter(
      (membership) =>
        !membership.invitation_expires_at || membership.invitation_expires_at <= now,
    )
    .map((membership) => membership.workspace_id);

  if (!nonExpired.length) {
    return {
      activated: [],
      expired: expiredWorkspaceIds,
      blocked: [],
      unavailable: unavailableWorkspaceIds,
    };
  }

  const activeMemberships = (activeResult.data ?? []) as unknown as ActiveMembership[];
  const activeWorkspaceIds = activeMemberships
    .filter((membership) => AVAILABLE_WORKSPACE_STATUSES.has(membership.workspaces.status))
    .map((membership) => membership.workspace_id);
  const selectedActiveWorkspaceId = activeWorkspaceIds.includes(
    profileResult.data?.active_workspace_id ?? "",
  )
    ? profileResult.data?.active_workspace_id
    : null;
  const baseWorkspaceId =
    selectedActiveWorkspaceId ?? activeWorkspaceIds[0] ?? nonExpired[0].workspace_id;

  const candidateIds = [
    ...new Set([
      baseWorkspaceId,
      ...activeWorkspaceIds,
      ...nonExpired.map((item) => item.workspace_id),
    ]),
  ];
  const { data: links, error: linksError } = await admin
    .from("business_group_workspaces")
    .select("group_id,workspace_id")
    .in("workspace_id", candidateIds);
  if (linksError) throw linksError;

  const baseGroups = new Set(
    (links ?? [])
      .filter((link) => link.workspace_id === baseWorkspaceId)
      .map((link) => link.group_id),
  );
  const allowedIds = new Set<string>([baseWorkspaceId]);
  for (const link of links ?? []) {
    if (baseGroups.has(link.group_id)) allowedIds.add(link.workspace_id);
  }

  const validWorkspaceIds = nonExpired
    .map((membership) => membership.workspace_id)
    .filter((workspaceId) => allowedIds.has(workspaceId));
  const blockedWorkspaceIds = nonExpired
    .map((membership) => membership.workspace_id)
    .filter((workspaceId) => !allowedIds.has(workspaceId));

  if (!validWorkspaceIds.length) {
    return {
      activated: [],
      expired: expiredWorkspaceIds,
      blocked: blockedWorkspaceIds,
      unavailable: unavailableWorkspaceIds,
    };
  }

  const { data, error } = await admin
    .from("workspace_memberships")
    .update({
      status: "active",
      joined_at: now,
      invitation_expires_at: null,
    })
    .eq("user_id", userId)
    .eq("status", "invited")
    .in("workspace_id", validWorkspaceIds)
    .select("workspace_id");
  if (error) throw error;

  const activated = (data ?? []).map((membership) => membership.workspace_id);
  if (activated.length) {
    // Replace a missing or stale selection. A stale suspended/cancelled workspace
    // must not keep the newly activated user outside their available business.
    if (!selectedActiveWorkspaceId) {
      const { error: profileError } = await admin
        .from("profiles")
        .update({ active_workspace_id: activated[0] })
        .eq("id", userId);
      if (profileError) {
        console.error("Activated membership but could not select the workspace", profileError);
      }
    }

    const { error: auditError } = await admin.from("audit_logs").insert(
      activated.map((workspaceId) => ({
        actor_user_id: userId,
        workspace_id: workspaceId,
        action: "team.invitation_accepted",
        entity_type: "membership",
        entity_id: userId,
        metadata: {},
      })),
    );
    if (auditError) {
      console.error("Invitation activation audit could not be recorded", auditError);
    }
  }

  if (blockedWorkspaceIds.length) {
    const { error: blockedAuditError } = await admin.from("audit_logs").insert(
      blockedWorkspaceIds.map((workspaceId) => ({
        actor_user_id: userId,
        workspace_id: workspaceId,
        action: "team.invitation_blocked_unlinked_business",
        entity_type: "membership",
        entity_id: userId,
        metadata: { active_workspace_id: baseWorkspaceId },
      })),
    );
    if (blockedAuditError) {
      console.error("Blocked invitation audit could not be recorded", blockedAuditError);
    }
  }

  return {
    activated,
    expired: expiredWorkspaceIds,
    blocked: blockedWorkspaceIds,
    unavailable: unavailableWorkspaceIds,
  };
}
