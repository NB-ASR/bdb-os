begin;

-- Customer Engine V1 Pass 1 — archived Customers keep historical Sales but
-- cannot be used for new completed Sales. Enforce this at the table boundary so
-- every current or future Sale creation path inherits the same Customer rule.
create or replace function private.enforce_active_sale_customer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.customer_id is null then
    return new;
  end if;

  if not exists (
    select 1
    from public.customers customer
    where customer.workspace_id = new.workspace_id
      and customer.id = new.customer_id
      and customer.status = 'active'
  ) then
    raise exception 'Archived or unavailable Customers cannot receive new Sales';
  end if;

  return new;
end;
$$;

drop trigger if exists sales_active_customer_guard on public.sales;
create trigger sales_active_customer_guard
before insert on public.sales
for each row execute function private.enforce_active_sale_customer();

commit;
