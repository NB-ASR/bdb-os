begin;

-- Ordinary users may read their own profile through RLS and update only the
-- fields that belong to personal profile management. Account state and
-- password-enforcement controls remain server-owned.
revoke all on table public.profiles from anon;
revoke insert, delete, truncate, references, trigger on table public.profiles from authenticated;
revoke update on table public.profiles from authenticated;
grant select on table public.profiles to authenticated;
grant update (full_name, phone, avatar_path, active_workspace_id)
  on table public.profiles to authenticated;

create or replace function private.enforce_profile_security_fields()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Service-role operations have no end-user auth.uid(). A platform admin is
  -- also allowed when the request has already satisfied the AAL2 requirement
  -- enforced by private.is_platform_admin().
  if (select auth.uid()) is null or private.is_platform_admin() then
    return new;
  end if;

  if new.id is distinct from old.id then
    raise exception 'Profile identity cannot be changed';
  end if;

  if new.is_active is distinct from old.is_active then
    raise exception 'Account status is managed by BDB OS';
  end if;

  if new.must_change_password is distinct from old.must_change_password then
    raise exception 'Password enforcement is managed by BDB OS';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_profile_security_fields() from public;

drop trigger if exists profiles_protect_security_fields on public.profiles;
create trigger profiles_protect_security_fields
before update on public.profiles
for each row execute function private.enforce_profile_security_fields();

-- Business activity is append-only and must be written through trusted server
-- commands. Members retain tenant-scoped read access through the existing RLS
-- policy, but cannot forge, edit or remove history directly from a browser.
alter table public.activity_items
  add column if not exists entity_type text,
  add column if not exists entity_id text,
  add column if not exists command_id uuid,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

create index if not exists activity_items_workspace_occurred_idx
  on public.activity_items (workspace_id, occurred_at desc);

create index if not exists activity_items_workspace_entity_idx
  on public.activity_items (workspace_id, entity_type, entity_id)
  where entity_type is not null and entity_id is not null;

revoke all on table public.activity_items from anon;
revoke insert, update, delete, truncate, references, trigger
  on table public.activity_items from authenticated;
grant select on table public.activity_items to authenticated;

drop policy if exists "Activity feature insert" on public.activity_items;

comment on column public.activity_items.command_id is
  'Correlates an immutable activity entry with the trusted server command that produced it.';
comment on table public.activity_items is
  'Append-only business history. Browser clients may read through RLS; trusted server commands write entries.';

commit;
