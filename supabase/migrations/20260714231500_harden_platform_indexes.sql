create policy "No client access to Stripe webhook events"
on public.stripe_webhook_events
for select
to authenticated
using (false);

create index if not exists audit_logs_actor_idx on public.audit_logs(actor_user_id);
create index if not exists contracts_created_by_idx on public.contracts(created_by);
create index if not exists contracts_plan_idx on public.contracts(plan_id);
create index if not exists plan_features_feature_idx on public.plan_features(feature_key);
create index if not exists subscriptions_contract_idx on public.subscriptions(contract_id);
create index if not exists subscriptions_plan_idx on public.subscriptions(plan_id);
create index if not exists workspace_feature_overrides_created_by_idx on public.workspace_feature_overrides(created_by);
create index if not exists workspace_feature_overrides_feature_idx on public.workspace_feature_overrides(feature_key);
create index if not exists workspace_memberships_invited_by_idx on public.workspace_memberships(invited_by);
