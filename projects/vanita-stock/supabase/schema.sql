-- Run this once in the Supabase SQL Editor for the dedicated Vanita project.
-- Staff accounts should be created by an administrator in Authentication > Users.

create table if not exists public.app_state (
  id text primary key,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  constraint vanita_only check (id = 'vanita')
);

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

insert into public.app_state (id, data)
values ('vanita', '{}'::jsonb)
on conflict (id) do nothing;

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
