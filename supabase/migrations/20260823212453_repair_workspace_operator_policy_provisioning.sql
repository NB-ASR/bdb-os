-- Repairs a Production-only operator-policy trigger defect discovered by the
-- rollback-only Vanita workspace provisioning rehearsal on 2026-08-23.
create or replace function private.sync_workspace_operator_policies()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  workflow text;
  resolved_key text;
  resolved_version integer;
begin
  if new.status <> 'published' or new.published_config is null then
    return new;
  end if;

  resolved_key := coalesce(new.published_config ->> 'key', 'general-services');
  resolved_version := greatest(1, coalesce((new.published_config ->> 'version')::integer, 1));

  update public.operator_policies policy
  set enabled = false,
      blueprint_key = resolved_key,
      blueprint_version = resolved_version,
      updated_at = now()
  where policy.workspace_id = new.workspace_id
    and not (new.published_config -> 'workflows' ? policy.workflow_key);

  for workflow in
    select jsonb_array_elements_text(coalesce(new.published_config -> 'workflows', '[]'::jsonb))
  loop
    insert into public.operator_policies (
      workspace_id,
      workflow_key,
      enabled,
      autonomy_mode,
      blueprint_key,
      blueprint_version,
      updated_by
    ) values (
      new.workspace_id,
      workflow,
      true,
      case
        when workflow in ('new-enquiry-triage', 'matter-deadline-review', 'recurring-compliance-check') then 'assist'
        else 'approval'
      end,
      resolved_key,
      resolved_version,
      new.updated_by
    )
    on conflict (workspace_id, workflow_key) do update set
      enabled = true,
      blueprint_key = excluded.blueprint_key,
      blueprint_version = excluded.blueprint_version,
      updated_by = excluded.updated_by,
      updated_at = now();
  end loop;

  return new;
end;
$function$;

revoke all on function private.sync_workspace_operator_policies() from public, anon, authenticated;
