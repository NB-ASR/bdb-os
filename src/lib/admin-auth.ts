import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminIdentity = { userId: string; email: string; role: "founder" | "support" };

export async function requirePlatformAdmin(): Promise<AdminIdentity> {
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) throw new Error("NOT_CONFIGURED");
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const claims = claimsData?.claims as { sub?: string; email?: string; aal?: string } | undefined;
  if (error || !claims?.sub) throw new Error("UNAUTHENTICATED");
  if (claims.aal !== "aal2") throw new Error("MFA_REQUIRED");
  const { data: record } = await admin.from("platform_admins").select("role, active").eq("user_id", claims.sub).eq("active", true).maybeSingle();
  if (!record) throw new Error("FORBIDDEN");
  return { userId: claims.sub, email: claims.email ?? "", role: record.role as AdminIdentity["role"] };
}

export function adminErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const knownStatuses: Record<string, number> = {
    NOT_CONFIGURED: 503,
    UNAUTHENTICATED: 401,
    MFA_REQUIRED: 428,
    FORBIDDEN: 403,
  };

  if (message in knownStatuses) {
    return Response.json({ error: message }, { status: knownStatuses[message] });
  }

  console.error("Founder Admin request failed", error);
  return Response.json({ error: "Founder Admin data could not be loaded." }, { status: 500 });
}
