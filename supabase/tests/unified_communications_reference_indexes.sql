begin;

select plan(1);

select ok(
  exists (
    select 1
    from pg_indexes
    where schemaname = 'public'
      and tablename = 'messages'
      and indexname = 'messages_thread_id_idx'
  ),
  'Communication Message thread foreign key has a covering index'
);

select * from finish();
rollback;
