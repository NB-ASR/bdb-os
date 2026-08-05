begin;

create or replace function private.prepare_sale_reference()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.reference :=
    'SALE-'
    || to_char(new.occurred_at at time zone 'UTC', 'YYYYMMDD')
    || '-'
    || upper(right(replace(new.id::text, '-', ''), 16));
  return new;
end;
$$;

create trigger sales_prepare_reference
before insert on public.sales
for each row execute function private.prepare_sale_reference();

revoke all on function private.prepare_sale_reference() from public;

comment on function private.prepare_sale_reference() is
  'Creates a deterministic Sale reference using the UTC Sale date and the final 64 bits of the Sale UUID.';

commit;
