begin;

select plan(12);

insert into auth.users (id, email) values
  ('71000000-0000-4000-8000-000000000001'::uuid, 'tenant-a@bdb.invalid'),
  ('71000000-0000-4000-8000-000000000002'::uuid, 'tenant-b@bdb.invalid');

insert into public.workspaces (id, slug, name, status, plan_id)
select fixture.id, fixture.slug, fixture.name, 'active', plan.id
from (
  values
    ('72000000-0000-4000-8000-000000000001'::uuid, 'tenant-isolation-a', 'Tenant isolation A'),
    ('72000000-0000-4000-8000-000000000002'::uuid, 'tenant-isolation-b', 'Tenant isolation B')
) as fixture(id, slug, name)
cross join lateral (
  select p.id
  from public.plans p
  join public.plan_features pf on pf.plan_id = p.id and pf.feature_key = 'accounts' and pf.enabled
  where p.is_active
  order by p.sort_order desc
  limit 1
) plan;

insert into public.workspace_memberships (workspace_id, user_id, role, status, access_profile, joined_at) values
  ('72000000-0000-4000-8000-000000000001'::uuid, '71000000-0000-4000-8000-000000000001'::uuid, 'owner', 'active', 'owner', now()),
  ('72000000-0000-4000-8000-000000000002'::uuid, '71000000-0000-4000-8000-000000000002'::uuid, 'owner', 'active', 'owner', now());

update public.profiles set active_workspace_id = '72000000-0000-4000-8000-000000000001'::uuid
where id = '71000000-0000-4000-8000-000000000001'::uuid;
update public.profiles set active_workspace_id = '72000000-0000-4000-8000-000000000002'::uuid
where id = '71000000-0000-4000-8000-000000000002'::uuid;

insert into public.customers (id, workspace_id, code, name, company) values
  ('73000000-0000-4000-8000-000000000001'::uuid, '72000000-0000-4000-8000-000000000001'::uuid, 'TENANT-A', 'Tenant A customer', ''),
  ('73000000-0000-4000-8000-000000000002'::uuid, '72000000-0000-4000-8000-000000000002'::uuid, 'TENANT-B', 'Tenant B customer', '');

insert into public.invoices (
  id, workspace_id, number, customer_id, due_at, description, amount, status, currency,
  customer_code_snapshot, customer_name_snapshot, gross_amount, discount_amount,
  net_amount, vat_amount, total_amount, created_by, updated_by
) values
  ('74000000-0000-4000-8000-000000000001'::uuid, '72000000-0000-4000-8000-000000000001'::uuid, 'DRAFT-TENANT-A', '73000000-0000-4000-8000-000000000001'::uuid, current_date + 14, 'Tenant A invoice', 100, 'draft', 'GBP', 'TENANT-A', 'Tenant A customer', 100, 0, 100, 0, 100, '71000000-0000-4000-8000-000000000001'::uuid, '71000000-0000-4000-8000-000000000001'::uuid),
  ('74000000-0000-4000-8000-000000000002'::uuid, '72000000-0000-4000-8000-000000000002'::uuid, 'DRAFT-TENANT-B', '73000000-0000-4000-8000-000000000002'::uuid, current_date + 14, 'Tenant B invoice', 100, 'draft', 'GBP', 'TENANT-B', 'Tenant B customer', 100, 0, 100, 0, 100, '71000000-0000-4000-8000-000000000002'::uuid, '71000000-0000-4000-8000-000000000002'::uuid);

insert into public.credit_notes (
  id, workspace_id, number, invoice_id, customer_id, currency, reason, status,
  customer_name_snapshot, created_by, updated_by
) values
  ('75000000-0000-4000-8000-000000000001'::uuid, '72000000-0000-4000-8000-000000000001'::uuid, 'DRAFT-CN-TENANT-A', '74000000-0000-4000-8000-000000000001'::uuid, '73000000-0000-4000-8000-000000000001'::uuid, 'GBP', 'Tenant A credit fixture', 'draft', 'Tenant A customer', '71000000-0000-4000-8000-000000000001'::uuid, '71000000-0000-4000-8000-000000000001'::uuid),
  ('75000000-0000-4000-8000-000000000002'::uuid, '72000000-0000-4000-8000-000000000002'::uuid, 'DRAFT-CN-TENANT-B', '74000000-0000-4000-8000-000000000002'::uuid, '73000000-0000-4000-8000-000000000002'::uuid, 'GBP', 'Tenant B credit fixture', 'draft', 'Tenant B customer', '71000000-0000-4000-8000-000000000002'::uuid, '71000000-0000-4000-8000-000000000002'::uuid);

select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is((select count(*) from public.invoices where id in ('74000000-0000-4000-8000-000000000001'::uuid, '74000000-0000-4000-8000-000000000002'::uuid)), 1::bigint, 'Tenant A sees exactly its Invoice');
select is((select count(*) from public.invoices where id = '74000000-0000-4000-8000-000000000002'::uuid), 0::bigint, 'Tenant A cannot fetch Tenant B Invoice by ID');
select is((select count(*) from public.credit_notes where id in ('75000000-0000-4000-8000-000000000001'::uuid, '75000000-0000-4000-8000-000000000002'::uuid)), 1::bigint, 'Tenant A sees exactly its Credit Note');
select is((select count(*) from public.credit_notes where id = '75000000-0000-4000-8000-000000000002'::uuid), 0::bigint, 'Tenant A cannot fetch Tenant B Credit Note by ID');
select is((select count(*) from public.invoice_account_balances where id = '74000000-0000-4000-8000-000000000002'::uuid), 0::bigint, 'Tenant A balance view cannot reveal Tenant B Invoice');
select is((select count(*) from public.business_document_index where workspace_id = '72000000-0000-4000-8000-000000000002'::uuid), 0::bigint, 'Tenant A document index cannot reveal Tenant B records');

reset role;
select set_config('request.jwt.claim.sub', '71000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;
select is((select count(*) from public.invoices where id in ('74000000-0000-4000-8000-000000000001'::uuid, '74000000-0000-4000-8000-000000000002'::uuid)), 1::bigint, 'Tenant B sees exactly its Invoice');
select is((select count(*) from public.invoices where id = '74000000-0000-4000-8000-000000000001'::uuid), 0::bigint, 'Tenant B cannot fetch Tenant A Invoice by ID');
select is((select count(*) from public.credit_notes where id in ('75000000-0000-4000-8000-000000000001'::uuid, '75000000-0000-4000-8000-000000000002'::uuid)), 1::bigint, 'Tenant B sees exactly its Credit Note');
select is((select count(*) from public.credit_notes where id = '75000000-0000-4000-8000-000000000001'::uuid), 0::bigint, 'Tenant B cannot fetch Tenant A Credit Note by ID');
select is((select count(*) from public.invoice_account_balances where id = '74000000-0000-4000-8000-000000000001'::uuid), 0::bigint, 'Tenant B balance view cannot reveal Tenant A Invoice');
select is((select count(*) from public.business_document_index where workspace_id = '72000000-0000-4000-8000-000000000001'::uuid), 0::bigint, 'Tenant B document index cannot reveal Tenant A records');

reset role;
select * from finish();
rollback;

