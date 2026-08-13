begin;

create table if not exists public.customer_notes (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  note_kind text not null default 'note' check (note_kind in ('note', 'void')),
  body text,
  parent_note_id uuid,
  reason text,
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id) on delete restrict,
  foreign key (workspace_id, parent_note_id)
    references public.customer_notes(workspace_id, id) on delete restrict,
  constraint customer_notes_shape_check check (
    (
      note_kind = 'note'
      and body is not null
      and char_length(trim(body)) between 1 and 4000
      and parent_note_id is null
      and reason is null
    )
    or
    (
      note_kind = 'void'
      and body is null
      and parent_note_id is not null
      and reason is not null
      and char_length(trim(reason)) between 5 and 500
      and parent_note_id <> id
    )
  )
);

create unique index if not exists customer_notes_one_void_per_note_idx
  on public.customer_notes(workspace_id, parent_note_id)
  where note_kind = 'void';

create index if not exists customer_notes_customer_time_idx
  on public.customer_notes(workspace_id, customer_id, occurred_at desc, created_at desc);

create index if not exists customer_notes_actor_idx
  on public.customer_notes(actor_user_id, occurred_at desc);

create table if not exists public.customer_note_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  note_id uuid not null,
  action text not null check (action in ('create', 'void')),
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  foreign key (workspace_id, note_id)
    references public.customer_notes(workspace_id, id) on delete cascade
);

create index if not exists customer_note_receipts_note_idx
  on public.customer_note_command_receipts(workspace_id, note_id, created_at desc);

create or replace function private.prevent_customer_note_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception 'Customer notes are append-only; add a linked void record instead';
end;
$$;

drop trigger if exists customer_notes_immutable on public.customer_notes;
create trigger customer_notes_immutable
before update or delete on public.customer_notes
for each row execute function private.prevent_customer_note_mutation();

alter table public.customer_notes enable row level security;
alter table public.customer_note_command_receipts enable row level security;

drop policy if exists "Customer notes permission read" on public.customer_notes;
create policy "Customer notes permission read"
on public.customer_notes for select to authenticated
using (private.has_workspace_permission(workspace_id, 'customers', 'view'));

revoke all on public.customer_notes from public, anon, authenticated;
grant select on public.customer_notes to authenticated;
revoke all on public.customer_note_command_receipts from public, anon, authenticated;

revoke all on function private.prevent_customer_note_mutation() from public, anon, authenticated;
grant execute on function private.prevent_customer_note_mutation() to service_role;

commit;
