import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

type Reminder = {
  subscription_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  workspace_id: string;
  user_id: string;
  booking_id: string;
  title: string;
  starts_at: string;
};

export const maxDuration = 60;

export async function GET(request: Request) {
  const startedAt = Date.now();
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!admin || !publicKey || !privateKey) {
    return Response.json({ ok: false, error: "Push reminders are not configured." }, { status: 503 });
  }

  webpush.setVapidDetails("mailto:support@bdb-os.com", publicKey, privateKey);
  const { data, error } = await admin.rpc("due_appointment_reminders");
  if (error) {
    console.error("[cron/appointment-reminders] claim failed", { code: error.code });
    return Response.json({ ok: false, error: "Reminder work could not be loaded." }, { status: 500 });
  }

  let sent = 0;
  let expired = 0;
  let failed = 0;
  for (const reminder of (data ?? []) as Reminder[]) {
    try {
      await webpush.sendNotification(
        { endpoint: reminder.endpoint, keys: { p256dh: reminder.p256dh, auth: reminder.auth } },
        JSON.stringify({
          title: "Appointment in one hour",
          body: reminder.title,
          url: "/calendar",
          tag: `booking-${reminder.booking_id}`,
        }),
        {
          TTL: 3_600,
          urgency: "normal",
          topic: reminder.booking_id.replaceAll("-", "").slice(0, 32),
        },
      );
      const delivery = await admin.from("notification_deliveries").insert({
        workspace_id: reminder.workspace_id,
        user_id: reminder.user_id,
        booking_id: reminder.booking_id,
        notification_type: "appointment_reminder",
      });
      if (delivery.error && delivery.error.code !== "23505") throw delivery.error;
      sent += 1;
    } catch (pushError) {
      const statusCode = typeof pushError === "object" && pushError && "statusCode" in pushError
        ? Number(pushError.statusCode)
        : 0;
      if ([404, 410].includes(statusCode)) {
        expired += 1;
        const removal = await admin.from("push_subscriptions").delete().eq("id", reminder.subscription_id);
        if (removal.error) console.error("[cron/appointment-reminders] expired subscription cleanup failed", { subscriptionId: reminder.subscription_id, code: removal.error.code });
      } else {
        failed += 1;
        console.error("[cron/appointment-reminders] delivery failed", { bookingId: reminder.booking_id, statusCode });
      }
    }
  }

  const result = {
    ok: true,
    checked: (data ?? []).length,
    sent,
    expired,
    failed,
    durationMs: Date.now() - startedAt,
  };
  console.info("[cron/appointment-reminders] complete", result);
  return Response.json(result, { headers: { "Cache-Control": "no-store, max-age=0" } });
}
