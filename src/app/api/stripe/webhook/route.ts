import Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import { createStripeClient } from "@/lib/stripe";

function subscriptionStatus(value: Stripe.Subscription.Status) {
  if (value === "canceled") return "cancelled";
  if (["active", "trialing", "past_due", "paused", "incomplete"].includes(value)) return value;
  return "incomplete";
}

async function syncSubscription(
  admin: NonNullable<ReturnType<typeof createAdminClient>>,
  subscription: Stripe.Subscription,
) {
  const workspaceId = subscription.metadata.workspace_id;
  if (!workspaceId) throw new Error("Subscription is missing workspace metadata");
  const firstItem = subscription.items.data[0];
  const { error: subscriptionError } = await admin.from("subscriptions").upsert({
    workspace_id: workspaceId,
    contract_id: subscription.metadata.contract_id || null,
    plan_id: subscription.metadata.plan_id || null,
    stripe_subscription_id: subscription.id,
    stripe_price_id: firstItem?.price.id ?? null,
    status: subscriptionStatus(subscription.status),
    current_period_start: firstItem?.current_period_start ? new Date(firstItem.current_period_start * 1000).toISOString() : null,
    current_period_end: firstItem?.current_period_end ? new Date(firstItem.current_period_end * 1000).toISOString() : null,
    cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
  }, { onConflict: "workspace_id" });
  if (subscriptionError) throw subscriptionError;

  const workspaceStatus = ["active", "trialing"].includes(subscription.status)
    ? "active"
    : subscription.status === "canceled" ? "cancelled" : "suspended";
  const { error: workspaceError } = await admin.from("workspaces")
    .update({ status: workspaceStatus })
    .eq("id", workspaceId);
  if (workspaceError) throw workspaceError;

  if (subscription.metadata.contract_id && ["active", "trialing"].includes(subscription.status)) {
    const { error: contractError } = await admin.from("contracts")
      .update({ status: "active", signed_at: new Date().toISOString() })
      .eq("id", subscription.metadata.contract_id);
    if (contractError) throw contractError;
  }
  await admin.from("audit_logs").insert({
    workspace_id: workspaceId,
    action: "billing.subscription_synced",
    entity_type: "subscription",
    entity_id: subscription.id,
    metadata: { status: subscription.status },
  });
}

export async function POST(request: Request) {
  const stripe = createStripeClient();
  const admin = createAdminClient();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  const signature = request.headers.get("stripe-signature");
  if (!stripe || !admin || !secret || !signature) {
    return Response.json({ error: "Webhook is not configured" }, { status: 503 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, secret);
  } catch {
    return Response.json({ error: "Invalid signature" }, { status: 400 });
  }

  const { data: existing } = await admin.from("stripe_webhook_events")
    .select("status")
    .eq("event_id", event.id)
    .maybeSingle();
  if (existing?.status === "processed" || existing?.status === "processing") {
    return Response.json({ received: true, duplicate: true });
  }
  const { error: claimError } = await admin.from("stripe_webhook_events").upsert({
    event_id: event.id,
    event_type: event.type,
    status: "processing",
    error_message: null,
  }, { onConflict: "event_id" });
  if (claimError) return Response.json({ error: "Could not claim webhook event" }, { status: 500 });

  try {
    if (["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"].includes(event.type)) {
      await syncSubscription(admin, event.data.object as Stripe.Subscription);
    }
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      if (typeof session.subscription === "string") {
        await syncSubscription(admin, await stripe.subscriptions.retrieve(session.subscription));
      }
    }
    await admin.from("stripe_webhook_events").update({
      status: "processed",
      processed_at: new Date().toISOString(),
      error_message: null,
    }).eq("event_id", event.id);
    return Response.json({ received: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown webhook failure";
    await admin.from("stripe_webhook_events").update({
      status: "failed",
      error_message: message.slice(0, 500),
    }).eq("event_id", event.id);
    console.error("Stripe webhook sync failed", { eventId: event.id, eventType: event.type, message });
    return Response.json({ error: "Sync failed" }, { status: 500 });
  }
}
