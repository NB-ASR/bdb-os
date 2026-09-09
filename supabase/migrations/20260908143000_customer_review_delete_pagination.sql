begin;

alter table public.customers
  add column if not exists needs_review boolean generated always as (
    nullif(trim(coalesce(name, '')), '') is null
    or (
      nullif(trim(coalesce(email, '')), '') is null
      and nullif(trim(coalesce(phone, '')), '') is null
    )
  ) stored;

create index if not exists customers_workspace_review_name_cursor_idx
  on public.customers (workspace_id, name, id)
  where needs_review;

create table if not exists public.customer_import_review_items (
  id uuid primary key,
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  import_key text not null,
  source_file text not null,
  source_row integer not null check (source_row > 0),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  issue_code text not null,
  issue_message text not null,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'dismissed')),
  created_by uuid not null references auth.users(id) on delete restrict,
  resolved_by uuid references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (workspace_id, import_key)
);

create table if not exists public.customer_delete_receipts (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  idempotency_key text not null check (char_length(idempotency_key) between 1 and 128),
  customer_id uuid not null,
  expected_version integer not null check (expected_version > 0),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  deleted_at timestamptz not null default now(),
  primary key (workspace_id, idempotency_key)
);

alter table public.customer_delete_receipts enable row level security;
revoke all on table public.customer_delete_receipts from public, anon, authenticated;

alter table public.customer_import_review_items enable row level security;
revoke all on table public.customer_import_review_items from public, anon, authenticated;
grant select on table public.customer_import_review_items to authenticated;

create policy "Customer review workspace read"
on public.customer_import_review_items for select to authenticated
using (private.actor_has_workspace_permission(workspace_id, auth.uid(), 'customers', 'view'));

create or replace function public.list_customer_register_page(
  p_workspace_id uuid,
  p_limit integer default 50,
  p_after_name text default null,
  p_after_id uuid default null,
  p_search text default null,
  p_filter text default 'active'
)
returns setof public.customers
language sql stable security invoker set search_path = ''
as $$
  select customer.*
  from public.customers customer
  where customer.workspace_id = p_workspace_id
    and case p_filter
      when 'active' then customer.status = 'active'
      when 'archived' then customer.status = 'archived'
      when 'review' then customer.needs_review
      when 'all' then true
      else false
    end
    and (p_after_name is null or p_after_id is null or (customer.name, customer.id) > (p_after_name, p_after_id))
    and (nullif(trim(coalesce(p_search, '')), '') is null or customer.search_text like '%' || lower(trim(p_search)) || '%')
  order by customer.name, customer.id
  limit least(greatest(coalesce(p_limit, 50), 1), 50) + 1;
$$;

create or replace function public.stage_customer_import_reviews(
  p_workspace_id uuid, p_actor_user_id uuid, p_items jsonb
)
returns integer language plpgsql security definer set search_path = ''
as $$
declare item jsonb; staged integer := 0;
begin
  if not private.customer_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Customer review access denied';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 5000 then
    raise exception 'Customer review batch is invalid';
  end if;
  for item in select value from jsonb_array_elements(p_items) loop
    insert into public.customer_import_review_items (
      id, workspace_id, import_key, source_file, source_row, payload, issue_code, issue_message, created_by
    ) values (
      (item->>'id')::uuid, p_workspace_id, item->>'importKey', left(item->>'sourceFile', 255),
      (item->>'sourceRow')::integer, coalesce(item->'payload', '{}'::jsonb),
      left(coalesce(item->>'issueCode', 'IMPORT_REVIEW'), 80), left(item->>'issueMessage', 1000), p_actor_user_id
    ) on conflict (workspace_id, import_key) do update set
      payload = excluded.payload, issue_code = excluded.issue_code, issue_message = excluded.issue_message,
      source_file = excluded.source_file, source_row = excluded.source_row, status = 'pending',
      resolved_by = null, resolved_at = null;
    staged := staged + 1;
  end loop;
  return staged;
end;
$$;

create or replace function public.resolve_customer_import_review(
  p_workspace_id uuid, p_actor_user_id uuid, p_review_id uuid, p_status text
)
returns void language plpgsql security definer set search_path = ''
as $$
begin
  if p_status not in ('resolved', 'dismissed') then raise exception 'Customer review status is invalid'; end if;
  if not private.customer_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then raise exception 'Customer review access denied'; end if;
  update public.customer_import_review_items set status = p_status, resolved_by = p_actor_user_id, resolved_at = now()
  where workspace_id = p_workspace_id and id = p_review_id and status = 'pending';
  if not found then raise exception 'Customer review item not found'; end if;
end;
$$;

create or replace function public.delete_archived_customer(
  p_workspace_id uuid, p_actor_user_id uuid, p_customer_id uuid, p_expected_version integer,
  p_idempotency_key text
)
returns void language plpgsql security definer set search_path = ''
as $$
declare customer_record public.customers%rowtype;
begin
  if not exists (
    select 1 from public.workspace_memberships membership
    join public.workspaces workspace on workspace.id = membership.workspace_id
    join public.profiles profile on profile.id = membership.user_id
    where membership.workspace_id = p_workspace_id and membership.user_id = p_actor_user_id
      and membership.role = 'owner' and membership.status = 'active'
      and workspace.status in ('trial', 'active') and profile.is_active is true
  ) then raise exception 'Only the workspace owner can delete Customers'; end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null or char_length(trim(p_idempotency_key)) > 128 then
    raise exception 'Customer deletion retry key is invalid';
  end if;
  if exists (
    select 1 from public.customer_delete_receipts receipt
    where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = trim(p_idempotency_key)
      and receipt.customer_id = p_customer_id and receipt.expected_version = p_expected_version
      and receipt.actor_user_id = p_actor_user_id
  ) then return; end if;
  if exists (
    select 1 from public.customer_delete_receipts receipt
    where receipt.workspace_id = p_workspace_id and receipt.idempotency_key = trim(p_idempotency_key)
  ) then raise exception 'Customer deletion retry key was already used'; end if;
  select * into customer_record from public.customers
  where workspace_id = p_workspace_id and id = p_customer_id for update;
  if not found then raise exception 'Customer not found'; end if;
  if customer_record.status <> 'archived' then raise exception 'Only archived Customers can be deleted'; end if;
  if customer_record.version <> p_expected_version then raise exception 'Customer changed on another device'; end if;
  if exists (select 1 from public.documents where workspace_id = p_workspace_id and customer_id = p_customer_id) then
    raise exception 'Customer has linked business history and cannot be deleted';
  end if;
  insert into public.audit_logs (workspace_id, actor_user_id, action, entity_type, entity_id, metadata)
  values (p_workspace_id, p_actor_user_id, 'customer.permanently_deleted', 'customer', p_customer_id::text,
    jsonb_build_object('code', customer_record.code, 'version', customer_record.version));
  begin
    delete from public.customers where workspace_id = p_workspace_id and id = p_customer_id;
  exception when foreign_key_violation then
      raise exception 'Customer has linked business history and cannot be deleted';
  end;
  insert into public.customer_delete_receipts (
    workspace_id, idempotency_key, customer_id, expected_version, actor_user_id
  ) values (
    p_workspace_id, trim(p_idempotency_key), p_customer_id, p_expected_version, p_actor_user_id
  );
end;
$$;

revoke all on function public.stage_customer_import_reviews(uuid,uuid,jsonb) from public, anon, authenticated;
revoke all on function public.resolve_customer_import_review(uuid,uuid,uuid,text) from public, anon, authenticated;
revoke all on function public.delete_archived_customer(uuid,uuid,uuid,integer,text) from public, anon, authenticated;
grant execute on function public.stage_customer_import_reviews(uuid,uuid,jsonb) to service_role;
grant execute on function public.resolve_customer_import_review(uuid,uuid,uuid,text) to service_role;
grant execute on function public.delete_archived_customer(uuid,uuid,uuid,integer,text) to service_role;

commit;
