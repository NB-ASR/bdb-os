create or replace function private.service_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'services',
    target_action
  );
$function$;

create or replace function private.sales_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'sales',
    case target_action
      when 'complete' then 'create'
      when 'reverse' then 'approve'
      else ''
    end
  );
$function$;

revoke all on function private.service_actor_can_write(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function private.sales_actor_can_write(uuid, uuid, text)
  from public, anon, authenticated;

grant execute on function private.service_actor_can_write(uuid, uuid, text)
  to service_role;
grant execute on function private.sales_actor_can_write(uuid, uuid, text)
  to service_role;
