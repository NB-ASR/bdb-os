begin;

-- Customer Engine V1 final Production-advisor closure.
-- Pass 3 added composite Communication integrity foreign keys. Cover the source
-- columns so future thread/customer or reply integrity checks do not require
-- full-table scans as the message ledger grows. No Customer, Communication or
-- Accounts business semantics are changed.

create index if not exists messages_workspace_thread_customer_idx
  on public.messages (workspace_id, thread_id, customer_id);

create index if not exists messages_workspace_thread_reply_idx
  on public.messages (workspace_id, thread_id, reply_to_message_id);

commit;
