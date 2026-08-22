#!/usr/bin/env bash
set -euo pipefail

DB_CONTAINER="$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -n 1)"
if [[ -z "${DB_CONTAINER}" ]]; then
  echo "Supabase database container was not found" >&2
  exit 1
fi

psql_exec() {
  docker exec -i "${DB_CONTAINER}" psql -U postgres -d postgres -v ON_ERROR_STOP=1 "$@"
}

WORKSPACE="61000000-0000-4000-8000-000000000001"
USER_ID="61000000-0000-4000-8000-000000000002"
SUPPLIER_ROOT="61000000-0000-4000-8000-000000000003"

# This fixture intentionally uses direct inserts only to create read-scale volume in
# the disposable database. Mutation correctness is exercised through the public
# commands in pgTAP and the multi-session concurrency test.
psql_exec <<SQL
\timing on
insert into auth.users(id,email) values ('${USER_ID}'::uuid,'pass4-scale@bdb.invalid');
insert into public.workspaces(id,slug,name) values ('${WORKSPACE}'::uuid,'pass4-scale','Pass 4 Scale');
insert into public.workspace_memberships(workspace_id,user_id,role,status,access_profile,joined_at)
values ('${WORKSPACE}'::uuid,'${USER_ID}'::uuid,'owner','active','owner',now());

insert into public.customers(id,workspace_id,code,name,company)
select md5('pass4-customer-'||g)::uuid,'${WORKSPACE}'::uuid,'P4C-'||lpad(g::text,6,'0'),'Pass 4 Customer '||g,''
from generate_series(1,5000) g;

insert into public.invoices(
  id,workspace_id,number,customer_id,due_at,description,amount,status,currency,
  customer_code_snapshot,customer_name_snapshot,gross_amount,discount_amount,net_amount,vat_amount,total_amount,
  created_by,updated_by
)
select
  md5('pass4-invoice-'||g)::uuid,'${WORKSPACE}'::uuid,'P4-DRAFT-'||g,
  md5('pass4-customer-'||(((g-1)%5000)+1))::uuid,null,'Pass 4 scale Invoice',118,'draft'::public.invoice_status,'EUR',
  'P4C-'||lpad((((g-1)%5000)+1)::text,6,'0'),'Pass 4 Customer '||(((g-1)%5000)+1),105,5,100,18,118,
  '${USER_ID}'::uuid,'${USER_ID}'::uuid
from generate_series(1,10000) g;

insert into public.invoice_lines(
  id,workspace_id,invoice_id,line_number,line_type,code_snapshot,description_snapshot,
  quantity,unit_price,gross_amount,discount_amount,net_amount,vat_rate,vat_amount,total_amount
)
select md5('pass4-invoice-line-'||g)::uuid,'${WORKSPACE}'::uuid,md5('pass4-invoice-'||g)::uuid,
  1,'manual','P4-SCALE','Pass 4 scale line',10,10.5,105,5,100,18,18,118
from generate_series(1,10000) g;

-- Exercise issue-time identity and permanent numbering across a large batch.
update public.invoices set status='sent'::public.invoice_status where workspace_id='${WORKSPACE}'::uuid;

insert into public.credit_notes(
  id,workspace_id,number,invoice_id,customer_id,currency,reason,status,customer_name_snapshot,
  gross_amount,discount_amount,net_amount,vat_amount,total_amount,created_by,updated_by
)
select md5('pass4-credit-'||g)::uuid,'${WORKSPACE}'::uuid,'P4-CN-'||g,md5('pass4-invoice-'||g)::uuid,
  md5('pass4-customer-'||(((g-1)%5000)+1))::uuid,'EUR','Pass 4 scale partial credit','draft','Pass 4 Customer '||(((g-1)%5000)+1),
  10.5,0.5,10,1.8,11.8,'${USER_ID}'::uuid,'${USER_ID}'::uuid
from generate_series(1,2000) g;

insert into public.credit_note_lines(
  id,workspace_id,credit_note_id,source_invoice_line_id,line_number,line_type,code_snapshot,description_snapshot,
  quantity,unit_price,gross_amount,discount_amount,net_amount,vat_rate,vat_amount,total_amount
)
select md5('pass4-credit-line-'||g)::uuid,'${WORKSPACE}'::uuid,md5('pass4-credit-'||g)::uuid,md5('pass4-invoice-line-'||g)::uuid,
  1,'manual','P4-SCALE','Pass 4 scale credit line',1,10.5,10.5,0.5,10,18,1.8,11.8
from generate_series(1,2000) g;

update public.credit_notes
set status='issued',issued_at=current_date,issued_by='${USER_ID}'::uuid,issued_at_timestamp=now()
where workspace_id='${WORKSPACE}'::uuid;

insert into public.delivery_notes(
  id,workspace_id,number,source_invoice_id,customer_id,customer_name_snapshot,delivery_date,status,created_by,updated_by
)
select md5('pass4-delivery-'||g)::uuid,'${WORKSPACE}'::uuid,'P4-DN-'||g,md5('pass4-invoice-'||g)::uuid,
  md5('pass4-customer-'||(((g-1)%5000)+1))::uuid,'Pass 4 Customer '||(((g-1)%5000)+1),current_date,'draft','${USER_ID}'::uuid,'${USER_ID}'::uuid
from generate_series(1,2000) g;
insert into public.delivery_note_lines(
  id,workspace_id,delivery_note_id,source_invoice_line_id,line_number,line_type,code_snapshot,description_snapshot,quantity
)
select md5('pass4-delivery-line-'||g)::uuid,'${WORKSPACE}'::uuid,md5('pass4-delivery-'||g)::uuid,md5('pass4-invoice-line-'||g)::uuid,
  1,'manual','P4-SCALE','Pass 4 scale delivery line',2
from generate_series(1,2000) g;
update public.delivery_notes
set status='issued',issued_by='${USER_ID}'::uuid,issued_at=now()
where workspace_id='${WORKSPACE}'::uuid;

insert into public.payments(
  id,workspace_id,reference,customer_id,customer_code_snapshot,customer_name_snapshot,currency,amount,payment_method,received_at,posted_by
)
select md5('pass4-payment-'||g)::uuid,'${WORKSPACE}'::uuid,'P4PAY-'||lpad(g::text,6,'0'),
  md5('pass4-customer-'||(((g-1)%5000)+1))::uuid,'P4C-'||lpad((((g-1)%5000)+1)::text,6,'0'),'Pass 4 Customer '||(((g-1)%5000)+1),
  'EUR',30,'bank_transfer',now()-(g||' seconds')::interval,'${USER_ID}'::uuid
from generate_series(1,5000) g;
insert into public.payment_allocations(
  id,workspace_id,payment_id,invoice_id,allocation_type,amount_delta,actor_user_id,command_id,occurred_at
)
select md5('pass4-payment-allocation-'||g)::uuid,'${WORKSPACE}'::uuid,md5('pass4-payment-'||g)::uuid,md5('pass4-invoice-'||g)::uuid,
  'allocation',30,'${USER_ID}'::uuid,md5('pass4-payment-command-'||g)::uuid,now()-(g||' seconds')::interval
from generate_series(1,5000) g;

insert into public.suppliers(id,workspace_id,code,name,supplier_type,document_currency)
select md5('pass4-supplier-'||g)::uuid,'${WORKSPACE}'::uuid,'P4S-'||lpad(g::text,4,'0'),'Pass 4 Supplier '||lpad(g::text,4,'0'),'expense','EUR'
from generate_series(1,500) g;

insert into public.documents(id,workspace_id,name,document_type,size_label,linked_to,created_by)
select md5('pass4-supplier-document-'||g)::uuid,'${WORKSPACE}'::uuid,'Pass 4 Supplier Invoice '||g,'Supplier invoice','1 KB','Supplier Accounts','${USER_ID}'::uuid
from generate_series(1,10000) g;

insert into public.supplier_documents(
  id,workspace_id,supplier_id,document_type,document_number,document_date,due_date,currency,
  subtotal_before_discount,discount_amount,net_after_discount,vat_rate,vat_amount,gross_amount,
  file_path,file_name,mime_type,file_size,file_sha256,status,extraction_status,accounts_posting_status,
  approved_at,approved_by,created_by,updated_by
)
select md5('pass4-supplier-document-'||g)::uuid,'${WORKSPACE}'::uuid,md5('pass4-supplier-'||(((g-1)%500)+1))::uuid,
  'invoice','P4-SINV-'||g,current_date-(g%365),current_date-(g%365)+30,'EUR',118,0,118,0,0,118,
  '${WORKSPACE}/scale/'||g||'.pdf',g||'.pdf','application/pdf',1024,
  md5('pass4-sha-a-'||g)||md5('pass4-sha-b-'||g),'approved','completed','posted',
  now()-(g||' seconds')::interval,'${USER_ID}'::uuid,'${USER_ID}'::uuid,'${USER_ID}'::uuid
from generate_series(1,10000) g;

insert into public.supplier_payables(
  id,workspace_id,supplier_document_id,supplier_id,supplier_code_snapshot,supplier_name_snapshot,document_type,
  document_number_snapshot,document_date,due_date,currency,amount,status,posted_at,posted_by
)
select md5('pass4-payable-'||g)::uuid,'${WORKSPACE}'::uuid,md5('pass4-supplier-document-'||g)::uuid,
  md5('pass4-supplier-'||(((g-1)%500)+1))::uuid,'P4S-'||lpad((((g-1)%500)+1)::text,4,'0'),'Pass 4 Supplier '||lpad((((g-1)%500)+1)::text,4,'0'),
  'invoice','P4-SINV-'||g,current_date-(g%365),current_date-(g%365)+30,'EUR',118,'posted',now()-(g||' seconds')::interval,'${USER_ID}'::uuid
from generate_series(1,10000) g;

insert into public.supplier_payments(
  id,workspace_id,reference,supplier_id,supplier_code_snapshot,supplier_name_snapshot,currency,amount,payment_method,paid_at,posted_by
)
select md5('pass4-supplier-payment-'||g)::uuid,'${WORKSPACE}'::uuid,'P4SPAY-'||g,
  md5('pass4-supplier-'||(((g-1)%500)+1))::uuid,'P4S-'||lpad((((g-1)%500)+1)::text,4,'0'),'Pass 4 Supplier '||lpad((((g-1)%500)+1)::text,4,'0'),
  'EUR',30,'bank_transfer',now()-(g||' seconds')::interval,'${USER_ID}'::uuid
from generate_series(1,5000) g;
insert into public.supplier_payment_allocations(
  id,workspace_id,supplier_payment_id,supplier_payable_id,allocation_type,amount_delta,actor_user_id,command_id,occurred_at
)
select md5('pass4-supplier-allocation-'||g)::uuid,'${WORKSPACE}'::uuid,md5('pass4-supplier-payment-'||g)::uuid,md5('pass4-payable-'||g)::uuid,
  'allocation',30,'${USER_ID}'::uuid,md5('pass4-supplier-command-'||g)::uuid,now()-(g||' seconds')::interval
from generate_series(1,5000) g;

analyze public.customers;
analyze public.invoices;
analyze public.credit_notes;
analyze public.delivery_notes;
analyze public.payments;
analyze public.payment_allocations;
analyze public.supplier_documents;
analyze public.supplier_payables;
analyze public.supplier_payments;
analyze public.supplier_payment_allocations;
analyze public.suppliers;

-- Dataset shape and core ledger reconciliation.
do \$\$
declare mismatch_count bigint; original_total numeric; invoice_count bigint;
begin
  select count(*) into invoice_count from public.invoices where workspace_id='${WORKSPACE}'::uuid;
  if invoice_count <> 10000 then raise exception 'Expected 10000 synthetic Invoices, got %', invoice_count; end if;
  if (select count(*) from public.customers where workspace_id='${WORKSPACE}'::uuid) <> 5000 then raise exception 'Synthetic Customer count mismatch'; end if;
  if (select count(*) from public.credit_notes where workspace_id='${WORKSPACE}'::uuid) <> 2000 then raise exception 'Synthetic Credit Note count mismatch'; end if;
  if (select count(*) from public.delivery_notes where workspace_id='${WORKSPACE}'::uuid) <> 2000 then raise exception 'Synthetic Delivery Note count mismatch'; end if;
  if (select count(*) from public.payments where workspace_id='${WORKSPACE}'::uuid) <> 5000 then raise exception 'Synthetic Payment count mismatch'; end if;
  if (select count(*) from public.supplier_payables where workspace_id='${WORKSPACE}'::uuid) <> 10000 then raise exception 'Synthetic Supplier Payable count mismatch'; end if;
  if (select count(*) from public.supplier_payments where workspace_id='${WORKSPACE}'::uuid) <> 5000 then raise exception 'Synthetic Supplier Payment count mismatch'; end if;

  select count(*) into mismatch_count
  from public.customer_account_balances balance
  where balance.workspace_id='${WORKSPACE}'::uuid
    and round(balance.net_balance,4) <> round(balance.outstanding_amount-balance.unallocated_credit,4);
  if mismatch_count <> 0 then raise exception 'Customer balance reconciliation failed for % Customers', mismatch_count; end if;

  select round(sum(total_amount),4) into original_total from public.invoices where workspace_id='${WORKSPACE}'::uuid;
  if original_total <> 1180000.0000 then raise exception 'Issued Invoice totals were rewritten: %', original_total; end if;

  if exists(select 1 from public.invoice_account_balances where workspace_id='${WORKSPACE}'::uuid and (outstanding_amount < 0 or overallocated_credit <> 0)) then
    raise exception 'Synthetic ledger contains negative outstanding or overallocated credit';
  end if;
end
\$\$;
SQL

# Principal Supplier register plans must be able to use the Pass 4 cursor indexes.
# The dataset is intentionally large enough that this checks a meaningful planner choice.
PAYABLE_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.supplier_payables where workspace_id='${WORKSPACE}'::uuid and document_type='invoice' order by posted_at desc,id desc limit 51;")"
DOCUMENT_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.supplier_documents where workspace_id='${WORKSPACE}'::uuid and status='approved' and accounts_posting_status in ('ready','posted','reversed') order by approved_at desc,id desc limit 51;")"
PAYMENT_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.supplier_payments where workspace_id='${WORKSPACE}'::uuid order by paid_at desc,id desc limit 51;")"
ALLOCATION_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.supplier_payment_allocations where workspace_id='${WORKSPACE}'::uuid order by occurred_at desc,id desc limit 51;")"
SUPPLIER_PLAN="$(psql_exec -Atc "explain (costs off) select id from public.suppliers where workspace_id='${WORKSPACE}'::uuid and status='active' order by name,id limit 51;")"

for pair in \
  "supplier_payables_register_cursor_idx|${PAYABLE_PLAN}" \
  "supplier_documents_accounts_cursor_idx|${DOCUMENT_PLAN}" \
  "supplier_payments_register_cursor_idx|${PAYMENT_PLAN}" \
  "supplier_payment_allocations_workspace_time_idx|${ALLOCATION_PLAN}" \
  "suppliers_active_search_idx|${SUPPLIER_PLAN}"; do
  expected="${pair%%|*}"
  plan="${pair#*|}"
  if ! grep -q "${expected}" <<<"${plan}"; then
    echo "Query plan did not use ${expected}:" >&2
    echo "${plan}" >&2
    exit 1
  fi
done

echo "Pass 4 synthetic dataset: 5,000 Customers, 10,000 Invoices, 2,000 Credit Notes, 2,000 Delivery Notes, 5,000 Payments/allocations, 500 Suppliers, 10,000 Supplier Payables, 5,000 Supplier Payments/allocations"
echo "Customer balance reconciliation: 5,000/5,000 matched ledger equation"
echo "Issued Invoice total preservation: EUR 1,180,000.0000 unchanged"
echo "Principal Supplier register query plans used all five intended Pass 4 indexes"
