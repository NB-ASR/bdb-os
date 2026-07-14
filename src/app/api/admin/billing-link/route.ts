import { requirePlatformAdmin, adminErrorResponse } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";

export async function POST(request: Request) {
  try {
    const identity = await requirePlatformAdmin(); const admin = createAdminClient(); const stripe = createStripeClient();
    if (!admin || !stripe) throw new Error("NOT_CONFIGURED");
    const body = await request.json() as { workspaceId?: string; monthlyAmount?: number; termMonths?: number; trialDays?: number };
    const amount = Math.round(Number(body.monthlyAmount) * 100); const term = Number(body.termMonths); const trialDays = Number(body.trialDays ?? 0);
    if (!body.workspaceId || amount < 100 || ![3, 6].includes(term) || ![0, 7, 14, 30].includes(trialDays)) return Response.json({ error: "A valid workspace, monthly quote, 3/6 month term and supported trial are required." }, { status: 400 });
    const { data: workspace } = await admin.from("workspaces").select("id,name,plan_id,stripe_customer_id").eq("id", body.workspaceId).single();
    if (!workspace) return Response.json({ error: "Workspace not found" }, { status: 404 });
    let customerId = workspace.stripe_customer_id;
    if (!customerId) { const customer = await stripe.customers.create({ name: workspace.name, metadata: { workspace_id: workspace.id } }); customerId = customer.id; await admin.from("workspaces").update({ stripe_customer_id: customerId }).eq("id", workspace.id); }
    const starts = new Date(); const minimumEnd = new Date(starts); minimumEnd.setMonth(minimumEnd.getMonth() + term);
    const contractId = crypto.randomUUID();
    const { error: contractError } = await admin.from("contracts").insert({ id: contractId, workspace_id: workspace.id, plan_id: workspace.plan_id, status: "sent", minimum_term_months: term, monthly_amount: amount / 100, currency: "GBP", starts_on: starts.toISOString().slice(0, 10), minimum_ends_on: minimumEnd.toISOString().slice(0, 10), created_by: identity.userId, notes: "Generated with Stripe billing link" });
    if (contractError) throw contractError;
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    const session = await stripe.checkout.sessions.create({ customer: customerId, mode: "subscription", success_url: `${origin}/settings?billing=success`, cancel_url: `${origin}/settings?billing=cancelled`, allow_promotion_codes: false, billing_address_collection: "auto", customer_update: { name: "auto", address: "auto" }, line_items: [{ quantity: 1, price_data: { currency: "gbp", unit_amount: amount, recurring: { interval: "month" }, product_data: { name: `BDB OS · ${workspace.name}`, description: `${term}-month minimum service commitment` } } }], subscription_data: { ...(trialDays ? { trial_period_days: trialDays } : {}), metadata: { workspace_id: workspace.id, plan_id: workspace.plan_id ?? "", contract_id: contractId, minimum_term_months: String(term) } }, metadata: { workspace_id: workspace.id, plan_id: workspace.plan_id ?? "", contract_id: contractId } });
    await admin.from("audit_logs").insert({ actor_user_id: identity.userId, workspace_id: workspace.id, action: "billing.checkout_created", entity_type: "contract", entity_id: contractId, metadata: { amount: amount / 100, term_months: term, trial_days: trialDays, checkout_session_id: session.id } });
    return Response.json({ url: session.url, contractId });
  } catch (error) { return adminErrorResponse(error); }
}
