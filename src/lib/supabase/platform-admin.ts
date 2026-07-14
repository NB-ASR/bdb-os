import { createClient } from "@/lib/supabase/server";

export async function requirePlatformAdmin() {
  const supabase = await createClient();
  if (!supabase) return { error: "not_configured" as const, userId: null };

  const { data: claimsData, error: claimsError } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (claimsError || !userId) return { error: "unauthenticated" as const, userId: null };

  const { data: admin } = await supabase
    .from("platform_admins")
    .select("user_id, role, active")
    .eq("user_id", userId)
    .eq("active", true)
    .maybeSingle();

  if (!admin) return { error: "forbidden" as const, userId };
  return { error: null, userId, role: admin.role as "founder" | "support" };
}
