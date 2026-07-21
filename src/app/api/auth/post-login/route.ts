import { createAdminClient } from "@/lib/supabase/admin";

export async function POST(request: Request) {
  const admin = createAdminClient();
  if (!admin) return Response.json({ error: "NOT_CONFIGURED" }, { status: 503 });

  const authorization = request.headers.get("authorization");
  const accessToken = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (!accessToken) return Response.json({ error: "MISSING_ACCESS_TOKEN" }, { status: 401 });

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    console.error("Post-login token verification failed", userError);
    return Response.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  // Founder access is provisioned only through the explicitly enabled,
  // one-time bootstrap route. Normal login must never grant or reactivate
  // platform privileges.
  const [profileResult, founderResult] = await Promise.all([
    admin
      .from("profiles")
      .select("must_change_password,is_active")
      .eq("id", userData.user.id)
      .maybeSingle(),
    admin
      .from("platform_admins")
      .select("active")
      .eq("user_id", userData.user.id)
      .eq("active", true)
      .maybeSingle(),
  ]);

  if (profileResult.error || founderResult.error) {
    console.error("Post-login account lookup failed", profileResult.error ?? founderResult.error);
    return Response.json({ error: "ACCOUNT_LOOKUP_FAILED" }, { status: 500 });
  }
  if (!profileResult.data || !profileResult.data.is_active) {
    return Response.json({ error: "ACCOUNT_NOT_ACTIVE" }, { status: 403 });
  }

  if (profileResult.data.must_change_password) return Response.json({ next: "/change-password" });
  if (founderResult.data) return Response.json({ next: "/mfa" });
  return Response.json({ next: "/workspace" });
}
