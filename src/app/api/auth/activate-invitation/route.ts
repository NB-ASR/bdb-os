import { createClient } from "@/lib/supabase/server";
import { createAdminClient, activatePendingMemberships } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    const admin = createAdminClient();
    if (!supabase || !admin) {
      return Response.json({ error: "Cloud authentication is not configured." }, { status: 503 });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      return Response.json({ error: "Your invitation session has expired. Request a new invitation." }, { status: 401 });
    }

    const body = (await request.json()) as { fullName?: string };
    const fullName = String(body.fullName ?? "").trim();
    if (fullName.length < 2 || fullName.length > 120) {
      return Response.json({ error: "Enter your full name." }, { status: 400 });
    }

    const { error: profileError } = await admin
      .from("profiles")
      .upsert({ id: userData.user.id, full_name: fullName, is_active: true }, { onConflict: "id" });
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
      return Response.json(
        {
          error: message,
          code: blocked ? "UNLINKED_BUSINESS" : expired ? "INVITATION_EXPIRED" : "NO_INVITATION",
        },
        { status: 409 },
      );
    }

    return Response.json({ ok: true, workspaceId: result.activated[0] });
  } catch (error) {
    console.error("Invitation activation failed", error);
    return Response.json({ error: "The invitation could not be activated." }, { status: 500 });
  }
}
