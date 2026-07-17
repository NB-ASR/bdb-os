import { createClient } from "@/lib/supabase/server";
import { createAdminClient, bootstrapFounder } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) return Response.json({ error: "NOT_CONFIGURED" }, { status: 503 });

  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const { data, error } = await supabase.auth.getUser(accessToken);
  if (error || !data.user) return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });

  await bootstrapFounder(data.user.id, data.user.email);
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("must_change_password")
    .eq("id", data.user.id)
    .maybeSingle();
  const { data: founder, error: founderError } = await admin
    .from("platform_admins")
    .select("active")
    .eq("user_id", data.user.id)
    .eq("active", true)
    .maybeSingle();

  if (profileError || founderError) {
    console.error("Post-login account lookup failed", profileError ?? founderError);
    return Response.json({ error: "ACCOUNT_LOOKUP_FAILED" }, { status: 500 });
  }

  if (profile?.must_change_password) return Response.json({ next: "/change-password" });
  if (founder) return Response.json({ next: "/mfa" });
  return Response.json({ next: "/workspace" });
}
