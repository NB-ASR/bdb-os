import { createClient } from "@/lib/supabase/server";
import { createAdminClient, bootstrapFounder } from "@/lib/supabase/admin";

export async function POST() {
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) return Response.json({ error: "NOT_CONFIGURED" }, { status: 503 });

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  await bootstrapFounder(data.user.id, data.user.email);
  const { data: profile } = await admin
    .from("profiles")
    .select("must_change_password")
    .eq("id", data.user.id)
    .maybeSingle();
  const { data: founder } = await admin
    .from("platform_admins")
    .select("active")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  if (profile?.must_change_password) return Response.json({ next: "/change-password" });
  if (founder) return Response.json({ next: "/mfa" });
  return Response.json({ next: "/workspace" });
}
