import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

type Reminder = { subscription_id: string; endpoint: string; p256dh: string; auth: string; workspace_id: string; user_id: string; booking_id: string; title: string; starts_at: string };

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || request.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const admin = createAdminClient(); const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY; const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!admin || !publicKey || !privateKey) return Response.json({ error: "Push is not configured" }, { status: 503 });
  webpush.setVapidDetails("mailto:support@bdb-os.com", publicKey, privateKey);
  const { data, error } = await admin.rpc("due_appointment_reminders"); if (error) return Response.json({ error: error.message }, { status: 500 });
  let sent = 0;
  for (const reminder of (data ?? []) as Reminder[]) {
    try {
      await webpush.sendNotification({ endpoint: reminder.endpoint, keys: { p256dh: reminder.p256dh, auth: reminder.auth } }, JSON.stringify({ title: "Appointment in one hour", body: reminder.title, url: "/calendar", tag: `booking-${reminder.booking_id}` }));
      await admin.from("notification_deliveries").insert({ workspace_id: reminder.workspace_id, user_id: reminder.user_id, booking_id: reminder.booking_id, notification_type: "appointment_reminder" }); sent += 1;
    } catch (pushError) {
      const statusCode = typeof pushError === "object" && pushError && "statusCode" in pushError ? Number(pushError.statusCode) : 0;
      if ([404, 410].includes(statusCode)) await admin.from("push_subscriptions").delete().eq("id", reminder.subscription_id);
    }
  }
  return Response.json({ checked: (data ?? []).length, sent });
}
