import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) {
    return Response.json({ error: "NOT_CONFIGURED" }, { status: 503 });
  }

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { error: updateError } = await admin
    .from("profiles")
    .update({ must_change_password: false })
    .eq("id", data.user.id);
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });

  const { data: founder } = await admin
    .from("platform_admins")
    .select("user_id")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  await admin.from("audit_logs").insert({
    actor_user_id: data.user.id,
    action: "security.password_changed",
    entity_type: "profile",
    entity_id: data.user.id,
    metadata: { founder: Boolean(founder) },
  });
  return Response.json({ ok: true, next: founder ? "/mfa" : "/workspace" });
}
