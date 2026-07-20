-- Run client-facing context RPCs with the signed-in caller's permissions. All
-- underlying public tables have RLS and the private authorization helpers use
-- auth.uid(), so elevated function execution is unnecessary.
alter function public.get_effective_features(uuid) security invoker;
alter function public.get_my_workspace_context() security invoker;

-- Cover foreign keys used during tenant deletes, joins and founder reporting.
create index if not exists activity_items_actor_user_idx on public.activity_items(actor_user_id);
create index if not exists audit_logs_actor_user_idx on public.audit_logs(actor_user_id);
create index if not exists automations_workspace_idx on public.automations(workspace_id);
create index if not exists bank_transactions_invoice_idx on public.bank_transactions(workspace_id, matched_invoice_id);
create index if not exists bookings_customer_idx on public.bookings(workspace_id, customer_id);
create index if not exists contracts_created_by_idx on public.contracts(created_by);
create index if not exists contracts_plan_idx on public.contracts(plan_id);
create index if not exists documents_customer_idx on public.documents(workspace_id, customer_id);
create index if not exists invitations_invited_by_idx on public.invitations(invited_by);
create index if not exists invoices_customer_idx on public.invoices(workspace_id, customer_id);
create index if not exists messages_customer_idx on public.messages(workspace_id, customer_id);
create index if not exists plan_features_feature_idx on public.plan_features(feature_key);
create index if not exists platform_admins_created_by_idx on public.platform_admins(created_by);
create index if not exists subscriptions_contract_idx on public.subscriptions(contract_id);
create index if not exists subscriptions_plan_idx on public.subscriptions(plan_id);
create index if not exists workspace_feature_overrides_creator_idx on public.workspace_feature_overrides(created_by);
create index if not exists workspace_feature_overrides_feature_idx on public.workspace_feature_overrides(feature_key);
create index if not exists workspace_memberships_invited_by_idx on public.workspace_memberships(invited_by);
create index if not exists workspace_themes_updated_by_idx on public.workspace_themes(updated_by);
create index if not exists workspaces_plan_idx on public.workspaces(plan_id);
