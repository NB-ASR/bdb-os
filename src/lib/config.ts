export function hasSupabaseConfig() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL
      && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

export function hasSupabaseAdminConfig() {
  return hasSupabaseConfig() && Boolean(process.env.SUPABASE_SECRET_KEY);
}

export function hasStripeConfig() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
}

export function isDemoMode() {
  return process.env.NEXT_PUBLIC_BDB_DEMO_MODE === "true" || !hasSupabaseConfig();
}

export function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
}
