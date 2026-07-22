import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

const STATUSES = new Set(["new", "contacted", "qualified", "won", "lost", "spam"]);

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const { data, error } = await admin
      .from("sales_enquiries")
      .select("id,name,business_name,email,starting_plan,sector,challenge,team_size,preferred_term,status,source,source_path,submitted_at,updated_at")
      .order("submitted_at", { ascending: false })
      .limit(250);
    if (error) throw error;
    return Response.json({ enquiries: data ?? [] });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = await request.json() as { enquiryId?: unknown; status?: unknown };
    const enquiryId = typeof body.enquiryId === "string" ? body.enquiryId : "";
    const status = typeof body.status === "string" ? body.status : "";
    if (!enquiryId || !STATUSES.has(status)) {
      return Response.json({ error: "Choose a valid enquiry and status." }, { status: 400 });
    }

    const now = new Date().toISOString();
    const { data, error } = await admin
      .from("sales_enquiries")
      .update({ status, updated_at: now })
      .eq("id", enquiryId)
      .select("id,status")
      .maybeSingle();
    if (error) throw error;
    if (!data) return Response.json({ error: "The enquiry was not found." }, { status: 404 });

    const { error: auditError } = await admin.from("audit_logs").insert({
      actor_user_id: identity.userId,
      action: "sales.enquiry_status_changed",
      entity_type: "sales_enquiry",
      entity_id: enquiryId,
      metadata: { status },
    });
    if (auditError) throw auditError;
    return Response.json({ ok: true, enquiry: data });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
