import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  DEV_ACCESS_COOKIE,
  evaluateDevAccess,
  matchesDevIdentity,
} from "@/lib/dev-access";

export type AdminIdentity = { userId: string; email: string; role: "founder" | "support" };

export async function requirePlatformAdmin(): Promise<AdminIdentity> {
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) throw new Error("NOT_CONFIGURED");
  const { data: claimsData, error } = await supabase.auth.getClaims();
  const claims = claimsData?.claims as { sub?: string; email?: string; aal?: string } | undefined;
  if (error || !claims?.sub) throw new Error("UNAUTHENTICATED");

  const devAccess = evaluateDevAccess();
  if (devAccess.enabled) {
    const cookieStore = await cookies();
    const devView = cookieStore.get(DEV_ACCESS_COOKIE)?.value;
    if (devView === "admin" && matchesDevIdentity("admin", claims.email)) {
      return { userId: claims.sub, email: claims.email ?? "", role: "founder" };
    }
  }

  if (claims.aal !== "aal2") throw new Error("MFA_REQUIRED");
  const { data: record } = await admin.from("platform_admins").select("role, active").eq("user_id", claims.sub).eq("active", true).maybeSingle();
  if (!record) throw new Error("FORBIDDEN");
  return { userId: claims.sub, email: claims.email ?? "", role: record.role as AdminIdentity["role"] };
}

export function adminErrorResponse(error: unknown) {
  const candidate = error as {
    message?: string;
    name?: string;
    code?: string;
    status?: number;
  } | null;
  const message = candidate?.message ?? "";
  const knownStatuses: Record<string, number> = {
    NOT_CONFIGURED: 503,
    UNAUTHENTICATED: 401,
    MFA_REQUIRED: 428,
    FORBIDDEN: 403,
  };

  if (message in knownStatuses) {
    return Response.json({ error: message }, { status: knownStatuses[message] });
  }

  const authDeliveryFailure =
    candidate?.name === "AuthRetryableFetchError" ||
    candidate?.code === "unexpected_failure" ||
    /send(?:ing)? (?:an? )?(?:invite|email)|invite email|smtp/i.test(message);
  if (authDeliveryFailure) {
    console.error("Founder Admin Auth delivery failed", error);
    return Response.json(
      {
        error: "Supabase Auth could not send the Owner invitation. Check the project's SMTP credentials and retry.",
        code: "AUTH_DELIVERY_UNAVAILABLE",
      },
      { status: 502 },
    );
  }

  console.error("Founder Admin request failed", error);
  return Response.json({ error: "Founder Admin data could not be loaded." }, { status: 500 });
}
