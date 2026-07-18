import { createClient } from "@/lib/supabase/server";
import { createAdminClient, activatePendingMemberships } from "@/lib/supabase/admin";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

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
    .select("workspace_id,invitation_expires_at")
    .eq("user_id", userId)
    .eq("status", "invited");
  if (error) throw error;

  const now = Date.now();
  const pending = data ?? [];
  const valid = pending.filter(
    (membership) =>
      !membership.invitation_expires_at ||
      new Date(membership.invitation_expires_at).getTime() > now,
  );

  return {
    valid,
    expired: pending.filter((membership) => !valid.includes(membership)),
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

    const body = (await request.json()) as { fullName?: string; preflight?: boolean };
    const fullName = String(body.fullName ?? "").trim();
    if (fullName.length < 2 || fullName.length > 120) {
      return json({ error: "Enter your full name." }, { status: 400 });
    }

    const pending = await pendingInvitationState(admin, userData.user.id);
    if (!pending.valid.length) {
      const expired = pending.expired.length > 0;
      return json(
        {
          error: expired
            ? "This invitation has expired. Ask the Business Owner or BDB Founder to resend it."
            : "No pending business invitation was found for this account.",
          code: expired ? "INVITATION_EXPIRED" : "NO_INVITATION",
        },
        { status: 409 },
      );
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
      const expired = result.expired.length > 0;
      const message = blocked
        ? "This account already belongs to a separate business. BDB must first link the companies inside an approved Business Group, or the new business must use a separate login email."
        : expired
          ? "This invitation has expired. Ask the Business Owner or BDB Founder to resend it."
          : "No pending business invitation was found for this account.";
      return json(
        {
          error: message,
          code: blocked ? "UNLINKED_BUSINESS" : expired ? "INVITATION_EXPIRED" : "NO_INVITATION",
        },
        { status: 409 },
      );
    }

    return json({ ok: true, workspaceId: result.activated[0] });
  } catch (error) {
    console.error("Invitation activation failed", error);
    return json({ error: "The invitation could not be activated." }, { status: 500 });
  }
}
