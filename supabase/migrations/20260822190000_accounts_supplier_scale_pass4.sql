-- Accounts Engine Hardening V1 — Pass 4: Scale + Torture Testing
--
-- This migration adds the read-path support needed to keep Supplier Payables bounded
-- at scale. It does not rewrite financial history or change posting/allocation rules.

-- Keep variable settlement/posting state out of the ordered key path. The registers
-- filter workspace/document type and then page by time + id; INCLUDE keeps state
-- available without breaking the index's ability to satisfy that ordering.
create index if not exists supplier_documents_accounts_cursor_idx
  on public.supplier_documents (
    workspace_id,
    status,
    approved_at desc,
    id desc
  ) include (accounts_posting_status);

create index if not exists supplier_payables_register_cursor_idx
  on public.supplier_payables (
    workspace_id,
    document_type,
    posted_at desc,
    id desc
  ) include (status);

create index if not exists supplier_payments_register_cursor_idx
  on public.supplier_payments (
    workspace_id,
    paid_at desc,
    id desc
  );

create index if not exists supplier_payment_allocations_workspace_time_idx
  on public.supplier_payment_allocations (
    workspace_id,
    occurred_at desc,
    id desc
  );

create index if not exists supplier_credit_allocations_workspace_time_idx
  on public.supplier_credit_allocations (
    workspace_id,
    occurred_at desc,
    id desc
  );

create index if not exists suppliers_active_search_idx
  on public.suppliers (
    workspace_id,
    status,
    name,
    id
  );

create or replace function public.get_supplier_accounts_summary(
  p_workspace_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  default_currency text;
  ready_document_count bigint;
  outstanding_amount numeric;
  unallocated_credit_amount numeric;
  supplier_account_count bigint;
begin
  select coalesce(settings.currency, 'EUR')
    into default_currency
  from public.workspace_settings settings
  where settings.workspace_id = p_workspace_id;

  default_currency := coalesce(default_currency, 'EUR');

  select count(*)
    into ready_document_count
  from public.supplier_documents document
  where document.workspace_id = p_workspace_id
    and document.status = 'approved'
    and document.accounts_posting_status in ('ready', 'reversed');

  select
    coalesce(sum(balance.outstanding_amount), 0),
    coalesce(sum(balance.unallocated_credit + balance.unallocated_payment), 0),
    count(*)
  into
    outstanding_amount,
    unallocated_credit_amount,
    supplier_account_count
  from public.supplier_account_balances balance
  where balance.workspace_id = p_workspace_id
    and balance.currency = default_currency;

  return jsonb_build_object(
    'currency', default_currency,
    'readyDocumentCount', coalesce(ready_document_count, 0),
    'outstandingAmount', round(coalesce(outstanding_amount, 0), 4),
    'unallocatedCreditAmount', round(coalesce(unallocated_credit_amount, 0), 4),
    'supplierAccountCount', coalesce(supplier_account_count, 0)
  );
end;
$function$;

revoke all on function public.get_supplier_accounts_summary(uuid) from public, anon, authenticated;
grant execute on function public.get_supplier_accounts_summary(uuid) to service_role;
