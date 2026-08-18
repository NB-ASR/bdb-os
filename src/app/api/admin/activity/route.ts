import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");

    const { data: platformAdmins, error: adminError } = await admin
      .from("platform_admins")
      .select("user_id")
      .eq("active", true);
    if (adminError) throw adminError;

    const founderIds = (platformAdmins ?? []).map((item) => item.user_id);
    if (!founderIds.length) {
      return Response.json({ cursor: 0, changedAt: null }, { headers: { "Cache-Control": "no-store" } });
    }

    const { data: latest, error } = await admin
      .from("audit_logs")
      .select("id,created_at")
      .in("actor_user_id", founderIds)
      .order("id", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;

    return Response.json(
      { cursor: Number(latest?.id ?? 0), changedAt: latest?.created_at ?? null },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return adminErrorResponse(error);
  }
}
