create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
create index if not exists notification_deliveries_workspace_idx on public.notification_deliveries(workspace_id);
