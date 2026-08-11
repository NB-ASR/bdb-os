export const PRODUCTION_SUPABASE_PROJECT_REF = "hgqdyqtdzxzoqqncwhix";

type SupabaseEnvironment = {
  VERCEL_ENV?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
};

export function supabaseProjectRef(value?: string) {
  if (!value) return null;

  try {
    const hostname = new URL(value).hostname.toLowerCase();
    const suffix = ".supabase.co";
    if (!hostname.endsWith(suffix)) return null;
    const projectRef = hostname.slice(0, -suffix.length);
    return /^[a-z0-9]{20}$/.test(projectRef) ? projectRef : null;
  } catch {
    return null;
  }
}

export function previewUsesProductionSupabase(
  environment?: SupabaseEnvironment,
) {
  const current = environment ?? {
    VERCEL_ENV: process.env.VERCEL_ENV,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  };

  return current.VERCEL_ENV === "preview" &&
    supabaseProjectRef(current.NEXT_PUBLIC_SUPABASE_URL) ===
      PRODUCTION_SUPABASE_PROJECT_REF;
}
