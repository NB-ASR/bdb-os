begin;

create index operator_runs_workspace_workflow_idx
  on public.operator_runs(workspace_id, workflow_key);

comment on index public.operator_runs_workspace_workflow_idx is
  'Covers the durable run to workspace policy foreign key and policy lookups.';

commit;
