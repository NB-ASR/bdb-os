import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { classifyFounderAdminError } from "@/lib/founder-admin";

export type AdminIdentity = { userId: string; email: string; role: "founder" | "support" };

export class AdminProductError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly publicMessage: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(code);
    this.name = "AdminProductError";
  }
}

export function adminProductError(
  code: string,
  status: number,
  message: string,
  details: Record<string, unknown> = {},
) {
  return new AdminProductError(code, status, message, details);
}

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
  if (error instanceof AdminProductError) {
    return Response.json(
      { error: error.publicMessage, code: error.code, ...error.details },
      { status: error.status },
    );
  }

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

  const classified = classifyFounderAdminError(error);
  if (classified) {
    return Response.json(
      { error: classified.message, code: classified.code },
      { status: classified.status },
    );
  }

  console.error("Founder Admin request failed", error);
  return Response.json(
    { error: "Founder Admin could not complete this request.", code: "UNEXPECTED_ADMIN_ERROR" },
    { status: 500 },
  );
}
