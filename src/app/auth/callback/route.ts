import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { activatePendingMemberships, bootstrapFounder } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") || "/workspace";
  const supabase = await createClient();
  if (code && supabase) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data } = await supabase.auth.getUser();
      if (data.user) { await activatePendingMemberships(data.user.id); await bootstrapFounder(data.user.id, data.user.email); }
      return NextResponse.redirect(new URL(next, url.origin));
    }
  }
  return NextResponse.redirect(new URL("/login?error=auth", url.origin));
}
