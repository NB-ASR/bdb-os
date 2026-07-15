import { createClient as createSupabaseClient, type User } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

const managerRoles = new Set(["owner", "admin", "manager"]);
const assignableRoles = new Set(["owner", "admin", "manager", "staff"]);
const memberStatuses = new Set(["active", "suspended"]);

async function context() {
  const supabase = await createClient();
  const admin = createAdminClient();
  const workspaceId = (await cookies()).get("bdb-workspace")?.value;
  if (!supabase || !admin) throw new Error("NOT_CONFIGURED");
  if (!workspaceId) throw new Error("NO_WORKSPACE");

  const { data: claims, error: claimsError } = await supabase.auth.getClaims();
  const userId = String(claims?.claims?.sub ?? "");
  if (claimsError || !userId) throw new Error("UNAUTHENTICATED");

  const { data: membership, error: membershipError } = await supabase
    .from("workspace_memberships")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership || !managerRoles.has(membership.role)) throw new Error("FORBIDDEN");
  return { admin, workspaceId, userId, actorRole: membership.role };
}

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : "REQUEST_FAILED";
  const status = message === "NOT_CONFIGURED" ? 503
    : message === "UNAUTHENTICATED" ? 401
      : message === "NO_WORKSPACE" ? 409
        : message === "FORBIDDEN" || message === "LAST_OWNER" ? 403
          : 500;
  const publicMessage = message === "NOT_CONFIGURED"
    ? "Cloud administration is not configured."
    : message === "LAST_OWNER"
      ? "A workspace must keep at least one active owner."
      : message === "FORBIDDEN"
        ? "You do not have permission to manage this team."
        : message;
  return Response.json({ error: publicMessage, code: message }, { status });
}

async function listUsersById(admin: NonNullable<ReturnType<typeof createAdminClient>>) {
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw error;
  return new Map(data.users.map((user) => [user.id, user]));
}

async function findUserByEmail(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  email: string,
): Promise<User | undefined> {
  const users = await listUsersById(admin);
  return [...users.values()].find((user) => user.email?.toLowerCase() === email);
}

export async function GET() {
  try {
    const { admin, workspaceId } = await context();
    const [{ data, error }, users] = await Promise.all([
      admin
        .from("workspace_memberships")
        .select("user_id,role,status,joined_at,profiles(full_name)")
        .eq("workspace_id", workspaceId)
        .order("created_at"),
      listUsersById(admin),
    ]);
    if (error) throw error;
    return Response.json({
      members: (data ?? []).map((member) => ({
        ...member,
        email: users.get(member.user_id)?.email ?? "",
      })),
    });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { admin, workspaceId, userId, actorRole } = await context();
    const body = await request.json() as { email?: string; role?: string };
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = assignableRoles.has(String(body.role)) ? String(body.role) : "staff";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return Response.json({ error: "Enter a valid work email." }, { status: 400 });
    }
    if (actorRole === "manager" && ["owner", "admin"].includes(role)) {
      return Response.json({ error: "Managers cannot assign owner or admin access." }, { status: 403 });
    }

    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const redirectTo = `${origin}/auth/callback?next=/workspace`;
    const existing = await findUserByEmail(admin, email);
    let invitedUser = existing;

    if (!invitedUser) {
      const invite = await admin.auth.admin.inviteUserByEmail(email, {
        data: { workspace_id: workspaceId, workspace_role: role },
        redirectTo,
      });
      if (invite.error || !invite.data.user) throw invite.error ?? new Error("Invite failed");
      invitedUser = invite.data.user;
    }

    const { error: membershipError } = await admin.from("workspace_memberships").upsert({
      workspace_id: workspaceId,
      user_id: invitedUser.id,
      role,
      status: existing ? "active" : "invited",
      invited_by: userId,
      ...(existing ? { joined_at: new Date().toISOString() } : {}),
    }, { onConflict: "workspace_id,user_id" });
    if (membershipError) {
      if (!existing) await admin.auth.admin.deleteUser(invitedUser.id);
      throw membershipError;
    }

    if (existing) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
      if (!url || !key) throw new Error("NOT_CONFIGURED");
      const authClient = createSupabaseClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: emailError } = await authClient.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
      });
      if (emailError) throw emailError;
    }

    await admin.from("audit_logs").insert({
      workspace_id: workspaceId,
      actor_user_id: userId,
      action: "team.member_invited",
      entity_type: "membership",
      entity_id: invitedUser.id,
      metadata: { email, role, existing_user: Boolean(existing) },
    });
    return Response.json({ ok: true, message: `Invitation sent to ${email}.` });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const { admin, workspaceId, userId, actorRole } = await context();
    const body = await request.json() as { userId?: string; role?: string; status?: string };
    const target = String(body.userId ?? "");
    const role = assignableRoles.has(String(body.role)) ? String(body.role) : undefined;
    const status = memberStatuses.has(String(body.status)) ? String(body.status) : undefined;
    if (!target || (!role && !status)) {
      return Response.json({ error: "Choose a valid role or status." }, { status: 400 });
    }

    const { data: targetMembership } = await admin
      .from("workspace_memberships")
      .select("role,status")
      .eq("workspace_id", workspaceId)
      .eq("user_id", target)
      .single();
    if (!targetMembership) return Response.json({ error: "Team member not found." }, { status: 404 });
    if (actorRole === "manager" && (["owner", "admin"].includes(targetMembership.role) || (role && ["owner", "admin"].includes(role)))) {
      return Response.json({ error: "Managers cannot change owner or admin access." }, { status: 403 });
    }

    const removesActiveOwner = targetMembership.role === "owner"
      && targetMembership.status === "active"
      && (role && role !== "owner" || status === "suspended");
    if (removesActiveOwner) {
      const { count } = await admin
        .from("workspace_memberships")
        .select("user_id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("role", "owner")
        .eq("status", "active");
      if ((count ?? 0) <= 1) throw new Error("LAST_OWNER");
    }

    const changes = { ...(role ? { role } : {}), ...(status ? { status } : {}) };
    const { error } = await admin
      .from("workspace_memberships")
      .update(changes)
      .eq("workspace_id", workspaceId)
      .eq("user_id", target);
    if (error) throw error;
    await admin.from("audit_logs").insert({
      workspace_id: workspaceId,
      actor_user_id: userId,
      action: "team.member_updated",
      entity_type: "membership",
      entity_id: target,
      metadata: changes,
    });
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
