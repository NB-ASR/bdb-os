begin;

create table if not exists public.communication_threads (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  customer_id uuid not null,
  channel text not null,
  subject text not null,
  status text not null default 'open',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  constraint communication_threads_customer_fkey
    foreign key (workspace_id, customer_id)
    references public.customers(workspace_id, id)
    on delete restrict,
  constraint communication_threads_channel_check
    check (channel in ('Email', 'WhatsApp', 'Instagram', 'Web')),
  constraint communication_threads_status_check
    check (status in ('open', 'closed')),
  constraint communication_threads_subject_check
    check (char_length(trim(subject)) between 1 and 240),
  constraint communication_threads_close_shape_check
    check (
      (status = 'open' and closed_at is null and closed_by is null)
      or
      (status = 'closed' and closed_at is not null and closed_by is not null)
    )
);

alter table public.messages
  add column if not exists thread_id uuid,
  add column if not exists direction text,
  add column if not exists body text,
  add column if not exists reply_to_message_id uuid,
  add column if not exists draft_state text,
  add column if not exists read_at timestamptz,
  add column if not exists read_by uuid references auth.users(id) on delete set null,
  add column if not exists recorded_by uuid references auth.users(id) on delete set null,
  add column if not exists command_id uuid;

insert into public.communication_threads (
  id,
  workspace_id,
  customer_id,
  channel,
  subject,
  status,
  last_message_at,
  created_at,
  updated_at,
  created_by
)
select message.id,
       message.workspace_id,
       message.customer_id,
       message.channel,
       message.subject,
       'open',
       message.occurred_at,
       message.created_at,
       message.updated_at,
       null
from public.messages message
on conflict (id) do nothing;

update public.messages
set thread_id = coalesce(thread_id, id),
    direction = coalesce(
      direction,
      case when status::text = 'replied' then 'outbound' else 'inbound' end
    ),
    body = coalesce(body, preview),
    draft_state = coalesce(
      draft_state,
      case when status::text = 'approval' then 'review' else 'none' end
    ),
    read_at = case
      when coalesce(direction, case when status::text = 'replied' then 'outbound' else 'inbound' end) = 'inbound'
       and unread = false
      then coalesce(read_at, occurred_at)
      else read_at
    end;

alter table public.messages
  alter column thread_id set not null,
  alter column direction set not null,
  alter column body set not null,
  alter column draft_state set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_thread_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_thread_id_fkey
      foreign key (thread_id)
      references public.communication_threads(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_reply_to_message_id_fkey'
  ) then
    alter table public.messages
      add constraint messages_reply_to_message_id_fkey
      foreign key (reply_to_message_id)
      references public.messages(id)
      on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_direction_check'
  ) then
    alter table public.messages
      add constraint messages_direction_check
      check (direction in ('inbound', 'outbound'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_draft_state_check'
  ) then
    alter table public.messages
      add constraint messages_draft_state_check
      check (draft_state in ('none', 'review', 'dismissed'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_body_check'
  ) then
    alter table public.messages
      add constraint messages_body_check
      check (char_length(trim(body)) between 1 and 10000);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_draft_direction_check'
  ) then
    alter table public.messages
      add constraint messages_draft_direction_check
      check (draft_state = 'none' or direction = 'outbound');
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.messages'::regclass
      and conname = 'messages_read_shape_check'
  ) then
    alter table public.messages
      add constraint messages_read_shape_check
      check (
        direction = 'outbound'
        or unread
        or read_at is not null
      );
  end if;
end
$$;

create table if not exists public.communication_command_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null,
  action text not null,
  thread_id uuid references public.communication_threads(id) on delete restrict,
  message_id uuid references public.messages(id) on delete restrict,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key),
  constraint communication_command_receipts_key_check
    check (char_length(trim(idempotency_key)) between 1 and 128),
  constraint communication_command_receipts_action_check
    check (action in ('record_message', 'mark_read', 'dismiss_draft', 'close_thread'))
);

create index if not exists communication_threads_workspace_activity_idx
  on public.communication_threads(workspace_id, last_message_at desc);
create index if not exists communication_threads_customer_activity_idx
  on public.communication_threads(workspace_id, customer_id, last_message_at desc);
create index if not exists communication_threads_created_by_idx
  on public.communication_threads(created_by) where created_by is not null;
create index if not exists communication_threads_closed_by_idx
  on public.communication_threads(closed_by) where closed_by is not null;
create index if not exists messages_thread_activity_idx
  on public.messages(workspace_id, thread_id, occurred_at asc, created_at asc);
create index if not exists messages_unread_inbound_idx
  on public.messages(workspace_id, occurred_at desc)
  where direction = 'inbound' and unread = true;
create index if not exists messages_reply_to_idx
  on public.messages(reply_to_message_id) where reply_to_message_id is not null;
create index if not exists messages_read_by_idx
  on public.messages(read_by) where read_by is not null;
create index if not exists messages_recorded_by_idx
  on public.messages(recorded_by) where recorded_by is not null;
create index if not exists communication_command_receipts_thread_idx
  on public.communication_command_receipts(thread_id) where thread_id is not null;
create index if not exists communication_command_receipts_message_idx
  on public.communication_command_receipts(message_id) where message_id is not null;

alter table public.communication_threads enable row level security;
alter table public.communication_command_receipts enable row level security;

revoke all on public.communication_threads from public, anon, authenticated;
revoke all on public.communication_command_receipts from public, anon, authenticated;
revoke all on public.messages from public, anon, authenticated;

grant select on public.communication_threads to authenticated;
grant select on public.messages to authenticated;

drop policy if exists "Communication threads permission read" on public.communication_threads;
create policy "Communication threads permission read"
on public.communication_threads
for select
to authenticated
using (private.has_workspace_permission(workspace_id, 'communications', 'view'));

drop policy if exists "Communications permission insert" on public.messages;
drop policy if exists "Communications permission update" on public.messages;
drop policy if exists "Communications permission delete" on public.messages;

create or replace view public.unified_communication_index
with (security_invoker = true)
as
select thread.id,
       thread.workspace_id,
       thread.customer_id,
       thread.channel,
       thread.subject,
       thread.status,
       thread.last_message_at,
       thread.created_at,
       thread.updated_at,
       thread.closed_at,
       count(message.id)::integer as message_count,
       count(message.id) filter (
         where message.direction = 'inbound'
           and message.unread = true
           and message.draft_state <> 'dismissed'
       )::integer as unread_count,
       count(message.id) filter (
         where message.draft_state = 'review'
       )::integer as draft_review_count,
       latest.id as latest_message_id,
       latest.direction as latest_direction,
       latest.body as latest_body,
       latest.draft_state as latest_draft_state,
       latest.occurred_at as latest_occurred_at
from public.communication_threads thread
join public.messages message
  on message.workspace_id = thread.workspace_id
 and message.thread_id = thread.id
left join lateral (
  select candidate.id,
         candidate.direction,
         candidate.body,
         candidate.draft_state,
         candidate.occurred_at
  from public.messages candidate
  where candidate.workspace_id = thread.workspace_id
    and candidate.thread_id = thread.id
  order by candidate.occurred_at desc, candidate.created_at desc, candidate.id desc
  limit 1
) latest on true
group by thread.id,
         thread.workspace_id,
         thread.customer_id,
         thread.channel,
         thread.subject,
         thread.status,
         thread.last_message_at,
         thread.created_at,
         thread.updated_at,
         thread.closed_at,
         latest.id,
         latest.direction,
         latest.body,
         latest.draft_state,
         latest.occurred_at;

revoke all on public.unified_communication_index from public, anon, authenticated;
grant select on public.unified_communication_index to authenticated;

commit;
