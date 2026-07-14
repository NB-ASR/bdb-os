alter table public.workspace_settings
add column if not exists timezone text not null default 'Europe/London';

create or replace function public.due_appointment_reminders()
returns table (
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text,
  workspace_id uuid,
  user_id uuid,
  booking_id uuid,
  title text,
  starts_at timestamptz
)
language sql
security definer
set search_path = ''
as $$
  select ps.id, ps.endpoint, ps.p256dh, ps.auth, b.workspace_id, ps.user_id,
    b.id, b.title,
    (b.booking_date + b.booking_time) at time zone coalesce(ws.timezone, 'Europe/London')
  from public.bookings b
  join public.workspace_settings ws on ws.workspace_id = b.workspace_id
  join public.push_subscriptions ps on ps.workspace_id = b.workspace_id
  join public.workspace_memberships wm on wm.workspace_id = b.workspace_id and wm.user_id = ps.user_id and wm.status = 'active'
  where b.status in ('confirmed', 'pending')
    and (b.booking_date + b.booking_time) at time zone coalesce(ws.timezone, 'Europe/London')
      between now() + interval '55 minutes' and now() + interval '65 minutes'
    and not exists (
      select 1 from public.notification_deliveries nd
      where nd.user_id = ps.user_id and nd.booking_id = b.id and nd.notification_type = 'appointment_reminder'
    );
$$;

revoke all on function public.due_appointment_reminders() from public, anon, authenticated;
grant execute on function public.due_appointment_reminders() to service_role;
