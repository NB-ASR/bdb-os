import { createClient } from "@/lib/supabase/server";
import { createAdminClient, activatePendingMemberships } from "@/lib/supabase/admin";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const AVAILABLE_WORKSPACE_STATUSES = new Set(["trial", "active"]);

function json(body: unknown, init?: ResponseInit) {
  return Response.json(body, {
    ...init,
    headers: { ...NO_STORE_HEADERS, ...init?.headers },
  });
}

async function pendingInvitationState(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  userId: string,
) {
  const { data, error } = await admin
    .from("workspace_memberships")
    .select("workspace_id,invitation_expires_at,workspaces!inner(status)")
    .eq("user_id", userId)
    .eq("status", "invited");
  if (error) throw error;

  const now = Date.now();
  const pending = (data ?? []) as unknown as Array<{
    workspace_id: string;
    invitation_expires_at: string | null;
    workspaces: { status: string };
  }>;
  const available = pending.filter((membership) =>
    AVAILABLE_WORKSPACE_STATUSES.has(membership.workspaces.status),
  );
  const valid = available.filter(
    (membership) =>
      Boolean(membership.invitation_expires_at) &&
      new Date(membership.invitation_expires_at!).getTime() > now,
  );

  return {
    valid,
    expired: available.filter((membership) => !valid.includes(membership)),
    unavailable: pending.filter(
      (membership) => !AVAILABLE_WORKSPACE_STATUSES.has(membership.workspaces.status),
    ),
  };
}

function invitationFailure(state: { expired: unknown[]; unavailable: unknown[] }) {
  if (state.unavailable.length > 0) {
    return {
      error: "The business linked to this invitation is not currently available. Ask a BDB Founder to review it.",
      code: "WORKSPACE_UNAVAILABLE",
    };
  }
  if (state.expired.length > 0) {
    return {
      error: "This invitation has expired. Ask the Business Owner or BDB Founder to resend it.",
      code: "INVITATION_EXPIRED",
    };
  }
  return {
    error: "No pending business invitation was found for this account.",
    code: "NO_INVITATION",
  };
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    if (!supabase || !admin) {
      return json({ error: "Cloud authentication is not configured." }, { status: 503 });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return json({ error: "Your invitation session has expired. Request a new invitation." }, { status: 401 });
    }

    const body = (await request.json().catch(() => null)) as {
      fullName?: string;
      preflight?: boolean;
    } | null;
    if (!body) return json({ error: "A valid request is required." }, { status: 400 });

    const fullName = String(body.fullName ?? "").trim();
    if (fullName.length < 2 || fullName.length > 120) {
      return json({ error: "Enter your full name." }, { status: 400 });
    }

    const pending = await pendingInvitationState(admin, userData.user.id);
    if (!pending.valid.length) {
      return json(invitationFailure(pending), { status: 409 });
    }

    if (body.preflight) {
      return json({ ok: true, invitationCount: pending.valid.length });
    }

    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ id: userData.user.id, full_name: fullName }, { onConflict: "id" });
    if (profileError) throw profileError;

    const result = await activatePendingMemberships(userData.user.id);
    if (!result.activated.length) {
      const blocked = result.blocked.length > 0;
      const unavailable = result.unavailable.length > 0;
      const expired = result.expired.length > 0;
      const failure = blocked
        ? {
            error: "This account already belongs to a separate business. BDB must first link the companies inside an approved Business Group, or the new business must use a separate login email.",
            code: "UNLINKED_BUSINESS",
          }
        : invitationFailure({
            unavailable: unavailable ? result.unavailable : [],
            expired: expired ? result.expired : [],
          });
      return json(failure, { status: 409 });
    }

    return json({ ok: true, workspaceId: result.activated[0] });
  } catch (error) {
    console.error("Invitation activation failed", error);
    return json({ error: "The invitation could not be activated." }, { status: 500 });
  }
}
