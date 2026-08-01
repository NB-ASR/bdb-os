begin;

create index if not exists messages_thread_id_idx
  on public.messages(thread_id);

commit;
