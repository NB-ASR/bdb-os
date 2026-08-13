import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { previewIsQuarantined } from "@/lib/supabase/environment";

export async function createClient() {
  if (previewIsQuarantined()) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return null;
  const cookieStore = await cookies();
  return createServerClient(url, key, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(items) {
        try { items.forEach(({ name, value, options }) => cookieStore.set(name, value, options)); }
        catch { /* Server Components cannot write cookies; proxy handles refresh. */ }
      },
    },
  });
}
