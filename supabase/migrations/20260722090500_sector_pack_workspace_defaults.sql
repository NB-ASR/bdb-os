begin;

create or replace function private.provision_default_sector_config()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  default_pack public.sector_packs%rowtype;
begin
  select *
  into default_pack
  from public.sector_packs
  where key = 'general-services'
    and version = 1
    and is_active
  limit 1;

  if default_pack.id is null then
    raise exception 'General Services Sector Pack is unavailable';
  end if;

  insert into public.workspace_sector_configs (
    workspace_id,
    sector_pack_id,
    draft_overrides,
    published_config,
    status,
    published_at
  )
  values (
    new.id,
    default_pack.id,
    '{}'::jsonb,
    default_pack.config,
    'published',
    now()
  )
  on conflict (workspace_id) do nothing;

  return new;
end;
$$;

revoke all on function private.provision_default_sector_config() from public;

insert into public.workspace_sector_configs (
  workspace_id,
  sector_pack_id,
  draft_overrides,
  published_config,
  status,
  published_at
)
select
  workspace.id,
  pack.id,
  '{}'::jsonb,
  pack.config,
  'published',
  now()
from public.workspaces workspace
cross join lateral (
  select id, config
  from public.sector_packs
  where key = 'general-services'
    and version = 1
    and is_active
  limit 1
) pack
on conflict (workspace_id) do nothing;

drop trigger if exists workspaces_provision_default_sector_config on public.workspaces;
create trigger workspaces_provision_default_sector_config
after insert on public.workspaces
for each row execute function private.provision_default_sector_config();

commit;
