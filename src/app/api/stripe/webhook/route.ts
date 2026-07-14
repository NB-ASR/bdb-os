import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";

function status(value: Stripe.Subscription.Status) { if (value === "canceled") return "cancelled"; if (["active", "trialing", "past_due", "paused", "incomplete"].includes(value)) return value; return "incomplete"; }

async function syncSubscription(subscription: Stripe.Subscription) {
  const admin = createAdminClient(); if (!admin) throw new Error("Supabase admin is not configured");
  const workspaceId = subscription.metadata.workspace_id; if (!workspaceId) throw new Error("Subscription is missing workspace metadata");
  const firstItem = subscription.items.data[0];
  await admin.from("subscriptions").upsert({ workspace_id: workspaceId, contract_id: subscription.metadata.contract_id || null, plan_id: subscription.metadata.plan_id || null, stripe_subscription_id: subscription.id, stripe_price_id: firstItem?.price.id ?? null, status: status(subscription.status), current_period_start: firstItem?.current_period_start ? new Date(firstItem.current_period_start * 1000).toISOString() : null, current_period_end: firstItem?.current_period_end ? new Date(firstItem.current_period_end * 1000).toISOString() : null, cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null }, { onConflict: "workspace_id" });
  await admin.from("workspaces").update({ status: ["active", "trialing"].includes(subscription.status) ? "active" : subscription.status === "canceled" ? "cancelled" : "suspended" }).eq("id", workspaceId);
  if (subscription.metadata.contract_id && ["active", "trialing"].includes(subscription.status)) await admin.from("contracts").update({ status: "active", signed_at: new Date().toISOString() }).eq("id", subscription.metadata.contract_id);
  await admin.from("audit_logs").insert({ workspace_id: workspaceId, action: "billing.subscription_synced", entity_type: "subscription", entity_id: subscription.id, metadata: { status: subscription.status } });
}

export async function POST(request: Request) {
  const stripe = createStripeClient(); const secret = process.env.STRIPE_WEBHOOK_SECRET; const signature = request.headers.get("stripe-signature");
  if (!stripe || !secret || !signature) return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(await request.text(), signature, secret); } catch { return Response.json({ error: "Invalid signature" }, { status: 400 }); }
  try {
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) await syncSubscription(event.data.object as Stripe.Subscription);
    if (event.type === "checkout.session.completed") { const session = event.data.object as Stripe.Checkout.Session; if (typeof session.subscription === "string") await syncSubscription(await stripe.subscriptions.retrieve(session.subscription)); }
    return Response.json({ received: true });
  } catch (error) { console.error("Stripe webhook sync failed", error); return Response.json({ error: "Sync failed" }, { status: 500 }); }
}
