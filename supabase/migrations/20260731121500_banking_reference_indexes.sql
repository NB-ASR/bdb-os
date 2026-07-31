begin;

create index if not exists bank_transactions_imported_by_idx
  on public.bank_transactions(imported_by, created_at desc)
  where imported_by is not null;

create index if not exists bank_transactions_reversed_by_idx
  on public.bank_transactions(reversed_by, reversed_at desc)
  where reversed_by is not null;

commit;
