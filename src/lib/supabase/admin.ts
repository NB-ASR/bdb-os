import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { hasSupabaseAdminConfig } from "@/lib/config";
import type { Database } from "./database.types";

let adminClient: SupabaseClient<Database> | null = null;

export function getAdminClient() {
  if (!hasSupabaseAdminConfig()) return null;
  if (!adminClient) {
    adminClient = createClient<Database>(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SECRET_KEY!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );
  }
  return adminClient;
}
