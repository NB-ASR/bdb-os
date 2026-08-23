begin;

-- Customer Engine V1 — Pass 2: Scale & Offline Reliability.
--
-- Replace whole-workspace Customer directory reads with a bounded, RLS-scoped
-- keyset register. Search remains intentionally prefix-based so the normal
-- business-user fields can use B-tree indexes instead of falling back to a
-- workspace-wide substring scan.

create index if not exists customers_workspace_status_name_cursor_idx
  on public.customers (workspace_id, status, name, id);

create index if not exists customers_workspace_imported_name_cursor_idx
  on public.customers (workspace_id, name, id)
  where legacy_source is not null;

create index if not exists customers_workspace_name_prefix_idx
  on public.customers (workspace_id, lower(name) text_pattern_ops);
create index if not exists customers_workspace_code_prefix_idx
  on public.customers (workspace_id, lower(code) text_pattern_ops);
create index if not exists customers_workspace_company_prefix_idx
  on public.customers (workspace_id, lower(company) text_pattern_ops);
create index if not exists customers_workspace_email_prefix_idx
  on public.customers (workspace_id, lower(email) text_pattern_ops)
  where email is not null;
create index if not exists customers_workspace_phone_prefix_idx
  on public.customers (workspace_id, lower(phone) text_pattern_ops)
  where phone is not null;

create or replace function public.list_customer_register_page(
  p_workspace_id uuid,
  p_limit integer default 100,
  p_after_name text default null,
  p_after_id uuid default null,
  p_search text default null,
  p_filter text default 'active'
)
returns setof public.customers
language sql
stable
security invoker
set search_path = ''
as $$
  select customer.*
  from public.customers customer
  where customer.workspace_id = p_workspace_id
    and case p_filter
      when 'active' then customer.status = 'active'
      when 'archived' then customer.status = 'archived'
      when 'imported' then customer.legacy_source is not null
      when 'all' then true
      else false
    end
    and (
      p_after_name is null
      or p_after_id is null
      or (customer.name, customer.id) > (p_after_name, p_after_id)
    )
    and (
      nullif(trim(coalesce(p_search, '')), '') is null
      or lower(customer.name) like lower(trim(p_search)) || '%'
      or lower(customer.code) like lower(trim(p_search)) || '%'
      or lower(customer.company) like lower(trim(p_search)) || '%'
      or (customer.email is not null and lower(customer.email) like lower(trim(p_search)) || '%')
      or (customer.phone is not null and lower(customer.phone) like lower(trim(p_search)) || '%')
    )
  order by customer.name, customer.id
  limit least(greatest(coalesce(p_limit, 100), 1), 100) + 1;
$$;

create or replace function public.customer_register_summary(
  p_workspace_id uuid
)
returns table (
  active_count bigint,
  archived_count bigint,
  imported_count bigint,
  company_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    count(*) filter (where customer.status = 'active')::bigint,
    count(*) filter (where customer.status = 'archived')::bigint,
    count(*) filter (where customer.legacy_source is not null)::bigint,
    count(distinct nullif(trim(customer.company), ''))::bigint
  from public.customers customer
  where customer.workspace_id = p_workspace_id;
$$;

revoke all on function public.list_customer_register_page(uuid, integer, text, uuid, text, text)
  from public, anon;
grant execute on function public.list_customer_register_page(uuid, integer, text, uuid, text, text)
  to authenticated, service_role;

revoke all on function public.customer_register_summary(uuid)
  from public, anon;
grant execute on function public.customer_register_summary(uuid)
  to authenticated, service_role;

commit;
