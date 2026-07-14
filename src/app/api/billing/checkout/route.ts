import { NextResponse, type NextRequest } from "next/server";
import { getAppUrl } from "@/lib/config";
import { getStripe } from "@/lib/stripe";
import { getAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const supabase = await createClient();
  const stripe = getStripe();
  const admin = getAdminClient();
  if (!supabase || !stripe || !admin) return NextResponse.json({ error: "Billing is not configured yet." }, { status: 503 });

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (!userId) return NextResponse.json({ error: "Authentication required." }, { status: 401 });

  const { data: context } = await supabase.rpc("get_my_workspace_context");
  const value = context as { workspace?: { id?: string; name?: string }; membership?: { role?: string } } | null;
  const workspaceId = value?.workspace?.id;
  if (!workspaceId || !["owner", "admin"].includes(value?.membership?.role ?? "")) return NextResponse.json({ error: "Only a workspace owner can start billing." }, { status: 403 });

  // The amount and term come exclusively from the founder-issued contract.
  // The browser cannot choose or modify a price.
  const { data: contract, error: contractError } = await supabase.from("contracts").select("id, status, monthly_amount, currency, minimum_term_months").eq("workspace_id", workspaceId).in("status", ["sent", "accepted"]).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (contractError || !contract || contract.monthly_amount === null || Number(contract.monthly_amount) <= 0) return NextResponse.json({ error: "No payable contract is ready for this workspace." }, { status: 400 });

  const { data: workspace } = await admin.from("workspaces").select("name, stripe_customer_id").eq("id", workspaceId).single();
  if (!workspace) return NextResponse.json({ error: "Workspace not found." }, { status: 404 });
  let customerId = workspace.stripe_customer_id;
  if (!customerId) {
    const email = typeof claimsData?.claims?.email === "string" ? claimsData.claims.email : undefined;
    const customer = await stripe.customers.create({ email, name: workspace.name, metadata: { workspaceId } });
    customerId = customer.id;
    await admin.from("workspaces").update({ stripe_customer_id: customerId }).eq("id", workspaceId);
  }

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    success_url: `${getAppUrl()}/settings?tab=plan&billing=success`,
    cancel_url: `${getAppUrl()}/settings?tab=plan&billing=cancelled`,
    allow_promotion_codes: false,
    line_items: [{
      quantity: 1,
      price_data: {
        currency: String(contract.currency).toLowerCase(),
        unit_amount: Math.round(Number(contract.monthly_amount) * 100),
        recurring: { interval: "month" },
        product_data: { name: `BDB OS · ${workspace.name}`, description: `${contract.minimum_term_months}-month minimum commitment · tailored workspace` },
      },
    }],
    metadata: { workspaceId, contractId: contract.id },
    subscription_data: { metadata: { workspaceId, contractId: contract.id, minimumTermMonths: String(contract.minimum_term_months) } },
  });

  if (contract.status === "sent") await admin.from("contracts").update({ status: "accepted", signed_at: new Date().toISOString() }).eq("id", contract.id);
  await admin.from("audit_logs").insert({ workspace_id: workspaceId, actor_user_id: userId, action: "contract.accepted_checkout_started", entity_type: "contract", entity_id: contract.id });
  return NextResponse.json({ url: session.url });
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
