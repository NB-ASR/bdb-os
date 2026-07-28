export type DevAccessView = "admin" | "workspace";
export type SupportAccessMode = "read_only" | "test_write";

export const DEV_ACCESS_COOKIE = "bdb-dev-view";
export const DEFAULT_DEV_ACCESS_GIT_REF = "integration/vanita-workspace";

export type DevAccessStatus = {
  enabled: boolean;
  reason: string | null;
  allowedGitRef: string;
  expectedSupabaseRef: string | null;
  actualSupabaseRef: string | null;
};

export function isDevAccessView(value: unknown): value is DevAccessView {
  return value === "admin" || value === "workspace";
}

export function extractSupabaseProjectRef(url: string | undefined): string | null {
  if (!url) return null;

  try {
    const hostname = new URL(url).hostname.toLowerCase();
    const databaseHost = hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
    if (databaseHost?.[1]) return databaseHost[1];

    const apiHost = hostname.match(/^([a-z0-9]+)\.supabase\.co$/);
    return apiHost?.[1] ?? null;
  } catch {
    return null;
  }
}

export function evaluateDevAccess(env: NodeJS.ProcessEnv = process.env): DevAccessStatus {
  const requested = env.BDB_DEV_ACCESS_ENABLED === "true";
  const isVercelPreview = env.VERCEL_ENV === "preview";
  const isLocalDevelopment = !env.VERCEL_ENV && env.NODE_ENV === "development";
  const runtimeAllowed = isVercelPreview || isLocalDevelopment;
  const allowedGitRef = env.BDB_DEV_ACCESS_GIT_REF?.trim() || DEFAULT_DEV_ACCESS_GIT_REF;
  const branchAllowed = isLocalDevelopment || env.VERCEL_GIT_COMMIT_REF === allowedGitRef;
  const expectedSupabaseRef = env.BDB_DEV_SUPABASE_REF?.trim() || null;
  const actualSupabaseRef = extractSupabaseProjectRef(env.NEXT_PUBLIC_SUPABASE_URL);
  const databaseAllowed = Boolean(
    expectedSupabaseRef && actualSupabaseRef && expectedSupabaseRef === actualSupabaseRef,
  );

  if (!requested) {
    return { enabled: false, reason: "Development access is disabled.", allowedGitRef, expectedSupabaseRef, actualSupabaseRef };
  }
  if (!runtimeAllowed) {
    return { enabled: false, reason: "Development access is blocked outside local development and Vercel Preview.", allowedGitRef, expectedSupabaseRef, actualSupabaseRef };
  }
  if (!branchAllowed) {
    return { enabled: false, reason: `Development access is restricted to ${allowedGitRef}.`, allowedGitRef, expectedSupabaseRef, actualSupabaseRef };
  }
  if (!databaseAllowed) {
    return { enabled: false, reason: "The configured Supabase project does not match the approved development project.", allowedGitRef, expectedSupabaseRef, actualSupabaseRef };
  }

  return { enabled: true, reason: null, allowedGitRef, expectedSupabaseRef, actualSupabaseRef };
}

export function supportAccessMode(env: NodeJS.ProcessEnv = process.env): SupportAccessMode {
  return evaluateDevAccess(env).enabled ? "test_write" : "read_only";
}

export function devIdentityEmail(
  view: DevAccessView,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const value = view === "admin" ? env.BDB_DEV_ADMIN_EMAIL : env.BDB_DEV_WORKSPACE_EMAIL;
  return value?.trim().toLowerCase() || null;
}

export function matchesDevIdentity(
  view: DevAccessView,
  email: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const expected = devIdentityEmail(view, env);
  return Boolean(expected && email && expected === email.trim().toLowerCase());
}
