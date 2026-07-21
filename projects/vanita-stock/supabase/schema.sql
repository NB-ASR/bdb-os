-- Run this in the dedicated Vanita Supabase project before enabling shared cloud editing.
-- Staff accounts should be created by an administrator in Authentication > Users.

create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  revision bigint not null default 0,
  updated_at timestamptz not null default now(),
  constraint vanita_only check (id = 'vanita')
);

alter table public.app_state add column if not exists revision bigint not null default 0;
alter table public.app_state enable row level security;

revoke all on table public.app_state from anon;
grant select, insert, update on table public.app_state to authenticated;

drop policy if exists "Vanita staff can read stock" on public.app_state;
create policy "Vanita staff can read stock"
on public.app_state for select
to authenticated
using (id = 'vanita');

drop policy if exists "Vanita staff can create stock" on public.app_state;
create policy "Vanita staff can create stock"
on public.app_state for insert
to authenticated
with check (id = 'vanita');

drop policy if exists "Vanita staff can update stock" on public.app_state;
create policy "Vanita staff can update stock"
on public.app_state for update
to authenticated
using (id = 'vanita')
with check (id = 'vanita');

insert into public.app_state (id, data, revision)
values ('vanita', '{}'::jsonb, 0)
on conflict (id) do nothing;

-- Prevent two staff devices from silently overwriting each other's stock changes.
-- The client sends the revision it loaded. A stale revision raises a serialization
-- conflict and forces a reload rather than accepting last-write-wins data loss.
create or replace function public.save_vanita_state(
  p_data jsonb,
  p_expected_revision bigint
)
returns table (revision bigint, updated_at timestamptz)
language plpgsql
security invoker
set search_path = public
as $$
begin
  return query
  update public.app_state as target
  set
    data = p_data,
    revision = target.revision + 1,
    updated_at = clock_timestamp()
  where target.id = 'vanita'
    and target.revision = p_expected_revision
  returning target.revision, target.updated_at;

  if not found then
    raise exception 'STATE_CONFLICT'
      using errcode = '40001',
            hint = 'Reload the latest Vanita state before saving again.';
  end if;
end;
$$;

revoke all on function public.save_vanita_state(jsonb, bigint) from public;
revoke all on function public.save_vanita_state(jsonb, bigint) from anon;
grant execute on function public.save_vanita_state(jsonb, bigint) to authenticated;

-- Private original-document storage for staff previews and downloads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'documents',
  'documents',
  false,
  3145728,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Vanita staff can upload documents" on storage.objects;
create policy "Vanita staff can upload documents"
on storage.objects for insert
to authenticated
with check (bucket_id = 'documents');

drop policy if exists "Vanita staff can read documents" on storage.objects;
create policy "Vanita staff can read documents"
on storage.objects for select
to authenticated
using (bucket_id = 'documents');

drop policy if exists "Vanita staff can delete documents" on storage.objects;
create policy "Vanita staff can delete documents"
on storage.objects for delete
to authenticated
using (bucket_id = 'documents');
