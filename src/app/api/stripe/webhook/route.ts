import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe";
import { getAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  const stripe = getStripe();
  const admin = getAdminClient();
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!stripe || !admin || !webhookSecret) return NextResponse.json({ error: "Webhook not configured." }, { status: 503 });
  const signature = request.headers.get("stripe-signature");
  if (!signature) return NextResponse.json({ error: "Missing Stripe signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(await request.text(), signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid Stripe signature." }, { status: 400 });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const workspaceId = session.metadata?.workspaceId;
    const contractId = session.metadata?.contractId;
    const subscriptionId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
    if (workspaceId && contractId && subscriptionId) {
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      await syncSubscription(admin, subscription, workspaceId, contractId);
      const { data: contract } = await admin.from("contracts").select("minimum_term_months, starts_on").eq("id", contractId).single();
      const startsOn = contract?.starts_on ?? new Date().toISOString().slice(0, 10);
      const minimumEndsOn = addMonths(startsOn, Number(contract?.minimum_term_months ?? 3));
      await admin.from("contracts").update({ status: "active", starts_on: startsOn, minimum_ends_on: minimumEndsOn, signed_at: new Date().toISOString() }).eq("id", contractId);
      await admin.from("workspaces").update({ status: "active" }).eq("id", workspaceId);
      await admin.from("audit_logs").insert({ workspace_id: workspaceId, action: "subscription.activated", entity_type: "subscription", entity_id: subscriptionId, metadata: { stripeEventId: event.id } });
    }
  }

  if (event.type === "customer.subscription.created" || event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
    const subscription = event.data.object;
    const workspaceId = subscription.metadata.workspaceId;
    const contractId = subscription.metadata.contractId;
    if (workspaceId && contractId) await syncSubscription(admin, subscription, workspaceId, contractId);
  }

  return NextResponse.json({ received: true });
}

async function syncSubscription(admin: NonNullable<ReturnType<typeof getAdminClient>>, subscription: Stripe.Subscription, workspaceId: string, contractId: string) {
  const firstItem = subscription.items.data[0];
  const status = mapStatus(subscription.status);
  await admin.from("subscriptions").upsert({
    workspace_id: workspaceId,
    contract_id: contractId,
    stripe_subscription_id: subscription.id,
    stripe_price_id: firstItem?.price.id ?? null,
    status,
    current_period_start: firstItem ? new Date(firstItem.current_period_start * 1000).toISOString() : null,
    current_period_end: firstItem ? new Date(firstItem.current_period_end * 1000).toISOString() : null,
    cancel_at: subscription.cancel_at ? new Date(subscription.cancel_at * 1000).toISOString() : null,
  }, { onConflict: "workspace_id" });
  if (["past_due", "paused", "cancelled"].includes(status)) await admin.from("workspaces").update({ status: status === "cancelled" ? "cancelled" : "suspended" }).eq("id", workspaceId);
}

function mapStatus(status: Stripe.Subscription.Status): "incomplete" | "trialing" | "active" | "past_due" | "paused" | "cancelled" {
  if (status === "trialing" || status === "active" || status === "past_due" || status === "paused") return status;
  if (status === "canceled" || status === "unpaid" || status === "incomplete_expired") return "cancelled";
  return "incomplete";
}

function addMonths(date: string, months: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}
