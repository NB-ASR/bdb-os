begin;

-- Keep every durable run bound to a policy in the same workspace. Commands
-- already validate this relationship; the constraint makes it impossible for
-- trusted maintenance code to accidentally create an orphaned or cross-tenant
-- run later.
alter table public.operator_runs
  add constraint operator_runs_workspace_policy_fkey
  foreign key (workspace_id, workflow_key)
  references public.operator_policies(workspace_id, workflow_key)
  on update cascade
  on delete restrict
  not valid;

alter table public.operator_runs
  validate constraint operator_runs_workspace_policy_fkey;

comment on constraint operator_runs_workspace_policy_fkey on public.operator_runs is
  'Binds a durable run to the matching workflow policy in the same workspace.';

commit;
