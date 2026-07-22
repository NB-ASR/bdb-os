begin;

-- Catalogue and commercial-intake tables are intentionally service-only. An
-- explicit deny policy documents that boundary and keeps security tooling from
-- interpreting the absence of browser policies as an oversight.
alter table public.sector_packs force row level security;
drop policy if exists "Sector Packs are service managed" on public.sector_packs;
create policy "Sector Packs are service managed"
  on public.sector_packs
  for all
  to anon, authenticated
  using (false)
  with check (false);

drop policy if exists "Sales enquiries are service managed" on public.sales_enquiries;
create policy "Sales enquiries are service managed"
  on public.sales_enquiries
  for all
  to anon, authenticated
  using (false)
  with check (false);

alter table public.workspace_sector_configs force row level security;
drop policy if exists "Workspace members can read published sector configuration"
  on public.workspace_sector_configs;
create policy "Workspace members can read published sector configuration"
  on public.workspace_sector_configs
  for select
  to authenticated
  using (
    status = 'published'
    and published_config is not null
    and exists (
      select 1
      from public.workspace_memberships membership
      where membership.workspace_id = workspace_sector_configs.workspace_id
        and membership.user_id = (select auth.uid())
        and membership.status = 'active'
    )
  );

-- Composite tenant references and nullable actor references are indexed so
-- cascading deletes and account deactivation remain predictable at scale.
create index if not exists sector_packs_created_by_idx
  on public.sector_packs(created_by)
  where created_by is not null;
create index if not exists workspace_sector_configs_updated_by_idx
  on public.workspace_sector_configs(updated_by)
  where updated_by is not null;
create index if not exists operator_policies_updated_by_idx
  on public.operator_policies(updated_by)
  where updated_by is not null;
create index if not exists operator_runs_created_by_idx
  on public.operator_runs(created_by)
  where created_by is not null;
create index if not exists operator_approvals_run_workspace_idx
  on public.operator_approvals(run_id, workspace_id);
create index if not exists operator_exceptions_run_workspace_idx
  on public.operator_exceptions(run_id, workspace_id);
create index if not exists operator_exceptions_assigned_to_idx
  on public.operator_exceptions(assigned_to)
  where assigned_to is not null;
create index if not exists operator_exceptions_resolved_by_idx
  on public.operator_exceptions(resolved_by)
  where resolved_by is not null;
create index if not exists operator_delivery_attempts_run_workspace_idx
  on public.operator_delivery_attempts(run_id, workspace_id);
create index if not exists operator_value_events_run_workspace_idx
  on public.operator_value_events(run_id, workspace_id);

alter table public.operator_approvals
  add constraint operator_approvals_requested_from_fkey
  foreign key (requested_from) references auth.users(id) on delete set null;
alter table public.operator_approvals
  add constraint operator_approvals_decided_by_fkey
  foreign key (decided_by) references auth.users(id) on delete set null;
create index if not exists operator_approvals_requested_from_idx
  on public.operator_approvals(requested_from)
  where requested_from is not null;
create index if not exists operator_approvals_decided_by_idx
  on public.operator_approvals(decided_by)
  where decided_by is not null;

-- This duplicate was introduced by the quality hardening migration after the
-- canonical foundation had already created the same workspace/time index.
drop index if exists public.activity_items_workspace_occurred_idx;

comment on function public.set_operator_policy(uuid, text, boolean, text, text, jsonb) is
  'Intentional authenticated SECURITY DEFINER command: fixed search_path, explicit auth.uid and operator edit permission check, browser table writes revoked.';
comment on function public.create_operator_run(uuid, text, text, text, text, jsonb, numeric, text) is
  'Intentional authenticated SECURITY DEFINER command: fixed search_path, explicit auth.uid and operator create permission check, idempotent atomic writes.';
comment on function public.decide_operator_run(uuid, uuid, text, integer, text) is
  'Intentional authenticated SECURITY DEFINER command: fixed search_path, explicit auth.uid and operator approve permission check, optimistic revision guard.';
comment on function public.complete_operator_run_manually(uuid, uuid, integer) is
  'Intentional authenticated SECURITY DEFINER command: fixed search_path, explicit auth.uid and operator edit permission check; manual completion records zero minutes saved.';

commit;
