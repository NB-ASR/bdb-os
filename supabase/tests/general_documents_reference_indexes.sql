begin;

select plan(5);

select ok(
  exists(select 1 from pg_indexes where schemaname='public' and indexname='documents_created_by_idx'),
  'Document creator foreign key has a covering index'
);
select ok(
  exists(select 1 from pg_indexes where schemaname='public' and indexname='documents_archived_by_idx'),
  'Document archiver foreign key has a covering index'
);
select ok(
  exists(select 1 from pg_indexes where schemaname='public' and indexname='document_links_created_by_idx'),
  'Document-link creator foreign key has a covering index'
);
select ok(
  exists(select 1 from pg_indexes where schemaname='public' and indexname='document_links_revoked_by_idx'),
  'Document-link revoker foreign key has a covering index'
);
select ok(
  exists(select 1 from pg_indexes where schemaname='public' and indexname='document_command_receipts_link_idx'),
  'Document receipt link foreign key has a covering index'
);

select * from finish();
rollback;
