import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";

export async function POST(request: Request) {
  const supabase = await createClient(); const admin = createAdminClient(); const stripe = createStripeClient(); const workspaceId = (await cookies()).get("bdb-workspace")?.value;
  if (!supabase || !admin || !stripe || !workspaceId) return Response.json({ error: "Not configured" }, { status: 503 });
  const { data: membership } = await supabase.from("workspace_memberships").select("role").eq("workspace_id", workspaceId).eq("status", "active").maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role)) return Response.json({ error: "Owner access required" }, { status: 403 });
  const { data: workspace } = await admin.from("workspaces").select("stripe_customer_id").eq("id", workspaceId).single(); if (!workspace?.stripe_customer_id) return Response.json({ error: "Billing has not been activated" }, { status: 409 });
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin; const session = await stripe.billingPortal.sessions.create({ customer: workspace.stripe_customer_id, return_url: `${origin}/settings` }); return Response.json({ url: session.url });
}
