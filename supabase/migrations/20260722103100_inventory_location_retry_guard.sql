begin;

create or replace function public.create_inventory_location(
  p_workspace_id uuid,
  p_location_id uuid,
  p_code text,
  p_name text,
  p_is_default boolean,
  p_actor_user_id uuid,
  p_command_id uuid
)
returns public.inventory_locations
language plpgsql
security definer
set search_path = ''
as $$
declare
  location_record public.inventory_locations;
begin
  if not private.inventory_actor_can_write(p_workspace_id, p_actor_user_id) then
    raise exception 'Inventory write access denied';
  end if;

  select * into location_record
  from public.inventory_locations
  where id = p_location_id;
  if location_record.id is not null then
    if location_record.workspace_id <> p_workspace_id then
      raise exception 'Inventory location identity conflict';
    end if;
    return location_record;
  end if;

  if p_is_default then
    update public.inventory_locations
    set is_default = false
    where workspace_id = p_workspace_id and is_default;
  end if;

  insert into public.inventory_locations (
    id, workspace_id, code, name, is_default, created_by
  ) values (
    p_location_id, p_workspace_id, trim(p_code), trim(p_name), p_is_default, p_actor_user_id
  )
  returning * into location_record;

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id,
    p_actor_user_id,
    'Inventory location created',
    location_record.name || ' · ' || location_record.code::text,
    'blue',
    'inventory_location',
    location_record.id::text,
    p_command_id,
    jsonb_build_object('is_default', location_record.is_default)
  );

  return location_record;
end;
$$;

revoke all on function public.create_inventory_location(uuid, uuid, text, text, boolean, uuid, uuid) from public, anon, authenticated;
grant execute on function public.create_inventory_location(uuid, uuid, text, text, boolean, uuid, uuid) to service_role;

commit;
