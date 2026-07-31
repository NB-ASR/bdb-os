begin;

create or replace view public.bank_transaction_reconciliation_balances
with (security_invoker = true)
as
select
  transaction.id,
  transaction.workspace_id,
  transaction.bank_account_id,
  account.code as bank_account_code,
  account.display_name as bank_account_name,
  account.institution_name,
  account.masked_identifier,
  transaction.statement_import_id,
  transaction.transaction_date,
  transaction.value_date,
  transaction.description,
  transaction.external_reference,
  transaction.amount,
  transaction.transaction_type,
  transaction.currency,
  transaction.fingerprint,
  transaction.source_row_number,
  transaction.record_status,
  transaction.reversed_at,
  transaction.reversal_reason,
  transaction.status as legacy_status,
  transaction.matched_invoice_id as legacy_matched_invoice_id,
  round(coalesce(sum(allocation.amount_delta), 0), 4) as reconciled_amount,
  greatest(round(transaction.amount - coalesce(sum(allocation.amount_delta), 0), 4), 0) as unreconciled_amount,
  case
    when transaction.record_status = 'reversed' then 'reversed'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) = 0 then 'unmatched'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) < transaction.amount then 'partially_matched'
    else 'matched'
  end as reconciliation_status,
  transaction.created_at
from public.bank_transactions transaction
left join public.bank_accounts account
  on account.workspace_id = transaction.workspace_id
 and account.id = transaction.bank_account_id
left join public.bank_reconciliation_allocations allocation
  on allocation.workspace_id = transaction.workspace_id
 and allocation.bank_transaction_id = transaction.id
group by
  transaction.id,
  transaction.workspace_id,
  transaction.bank_account_id,
  account.code,
  account.display_name,
  account.institution_name,
  account.masked_identifier,
  transaction.statement_import_id,
  transaction.transaction_date,
  transaction.value_date,
  transaction.description,
  transaction.external_reference,
  transaction.amount,
  transaction.transaction_type,
  transaction.currency,
  transaction.fingerprint,
  transaction.source_row_number,
  transaction.record_status,
  transaction.reversed_at,
  transaction.reversal_reason,
  transaction.status,
  transaction.matched_invoice_id,
  transaction.created_at;

create or replace view public.customer_payment_reconciliation_balances
with (security_invoker = true)
as
select
  payment.id,
  payment.workspace_id,
  payment.reference,
  payment.customer_id,
  payment.customer_code_snapshot,
  payment.customer_name_snapshot,
  payment.currency,
  payment.amount,
  payment.payment_method,
  payment.external_reference,
  payment.received_at,
  payment.status,
  round(coalesce(sum(allocation.amount_delta), 0), 4) as bank_reconciled_amount,
  greatest(round(payment.amount - coalesce(sum(allocation.amount_delta), 0), 4), 0) as bank_unreconciled_amount,
  case
    when payment.status = 'reversed' then 'reversed'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) = 0 then 'unmatched'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) < payment.amount then 'partially_matched'
    else 'matched'
  end as bank_reconciliation_status
from public.payments payment
left join public.bank_reconciliation_allocations allocation
  on allocation.workspace_id = payment.workspace_id
 and allocation.customer_payment_id = payment.id
group by
  payment.id,
  payment.workspace_id,
  payment.reference,
  payment.customer_id,
  payment.customer_code_snapshot,
  payment.customer_name_snapshot,
  payment.currency,
  payment.amount,
  payment.payment_method,
  payment.external_reference,
  payment.received_at,
  payment.status;

create or replace view public.supplier_payment_reconciliation_balances
with (security_invoker = true)
as
select
  payment.id,
  payment.workspace_id,
  payment.reference,
  payment.supplier_id,
  payment.supplier_code_snapshot,
  payment.supplier_name_snapshot,
  payment.currency,
  payment.amount,
  payment.payment_method,
  payment.external_reference,
  payment.paid_at,
  payment.status,
  round(coalesce(sum(allocation.amount_delta), 0), 4) as bank_reconciled_amount,
  greatest(round(payment.amount - coalesce(sum(allocation.amount_delta), 0), 4), 0) as bank_unreconciled_amount,
  case
    when payment.status = 'reversed' then 'reversed'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) = 0 then 'unmatched'
    when round(coalesce(sum(allocation.amount_delta), 0), 4) < payment.amount then 'partially_matched'
    else 'matched'
  end as bank_reconciliation_status
from public.supplier_payments payment
left join public.bank_reconciliation_allocations allocation
  on allocation.workspace_id = payment.workspace_id
 and allocation.supplier_payment_id = payment.id
group by
  payment.id,
  payment.workspace_id,
  payment.reference,
  payment.supplier_id,
  payment.supplier_code_snapshot,
  payment.supplier_name_snapshot,
  payment.currency,
  payment.amount,
  payment.payment_method,
  payment.external_reference,
  payment.paid_at,
  payment.status;

create or replace view public.bank_account_reconciliation_summaries
with (security_invoker = true)
as
select
  account.id as bank_account_id,
  account.workspace_id,
  account.code,
  account.display_name,
  account.institution_name,
  account.masked_identifier,
  account.currency,
  account.status,
  round(coalesce(sum(
    case when transaction.record_status = 'posted' and transaction.transaction_type = 'credit'
      then transaction.amount else 0 end
  ), 0), 4) as imported_credit_amount,
  round(coalesce(sum(
    case when transaction.record_status = 'posted' and transaction.transaction_type = 'debit'
      then transaction.amount else 0 end
  ), 0), 4) as imported_debit_amount,
  round(coalesce(sum(
    case
      when transaction.record_status = 'posted' and transaction.transaction_type = 'credit'
        then transaction.amount
      when transaction.record_status = 'posted' and transaction.transaction_type = 'debit'
        then -transaction.amount
      else 0
    end
  ), 0), 4) as imported_net_movement,
  count(transaction.id) filter (
    where transaction.record_status = 'posted'
  )::integer as transaction_count,
  count(transaction.id) filter (
    where transaction.record_status = 'posted'
      and transaction.reconciliation_status <> 'matched'
  )::integer as review_count
from public.bank_accounts account
left join public.bank_transaction_reconciliation_balances transaction
  on transaction.workspace_id = account.workspace_id
 and transaction.bank_account_id = account.id
group by
  account.id,
  account.workspace_id,
  account.code,
  account.display_name,
  account.institution_name,
  account.masked_identifier,
  account.currency,
  account.status;

alter table public.bank_accounts enable row level security;
alter table public.bank_statement_imports enable row level security;
alter table public.bank_reconciliation_allocations enable row level security;
alter table public.banking_command_receipts enable row level security;

drop policy if exists "Banking permission insert" on public.bank_transactions;
drop policy if exists "Banking permission update" on public.bank_transactions;
drop policy if exists "Banking permission delete" on public.bank_transactions;
drop policy if exists "Banking permission read" on public.bank_transactions;
create policy "Banking transaction read"
on public.bank_transactions for select to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'view'));

create policy "Bank accounts read"
on public.bank_accounts for select to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'view'));

create policy "Bank statement imports read"
on public.bank_statement_imports for select to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'view'));

create policy "Bank reconciliation allocations read"
on public.bank_reconciliation_allocations for select to authenticated
using (private.has_workspace_permission(workspace_id, 'banking', 'view'));

drop policy if exists "Payments permission read" on public.payments;
create policy "Payments Accounts or Banking read"
on public.payments for select to authenticated
using (
  private.has_workspace_permission(workspace_id, 'accounts', 'view')
  or private.has_workspace_permission(workspace_id, 'banking', 'view')
);

drop policy if exists "Supplier Payments Accounts read" on public.supplier_payments;
create policy "Supplier Payments Accounts or Banking read"
on public.supplier_payments for select to authenticated
using (
  private.has_workspace_permission(workspace_id, 'accounts', 'view')
  or private.has_workspace_permission(workspace_id, 'banking', 'view')
);

revoke all on public.bank_accounts from anon, authenticated;
revoke all on public.bank_statement_imports from anon, authenticated;
revoke all on public.bank_transactions from anon, authenticated;
revoke all on public.bank_reconciliation_allocations from anon, authenticated;
revoke all on public.banking_command_receipts from anon, authenticated;

grant select on public.bank_accounts to authenticated;
grant select on public.bank_statement_imports to authenticated;
grant select on public.bank_transactions to authenticated;
grant select on public.bank_reconciliation_allocations to authenticated;
grant select on public.bank_transaction_reconciliation_balances to authenticated;
grant select on public.customer_payment_reconciliation_balances to authenticated;
grant select on public.supplier_payment_reconciliation_balances to authenticated;
grant select on public.bank_account_reconciliation_summaries to authenticated;

grant all on public.bank_accounts to service_role;
grant all on public.bank_statement_imports to service_role;
grant all on public.bank_transactions to service_role;
grant all on public.bank_reconciliation_allocations to service_role;
grant all on public.banking_command_receipts to service_role;
grant select on public.bank_transaction_reconciliation_balances to service_role;
grant select on public.customer_payment_reconciliation_balances to service_role;
grant select on public.supplier_payment_reconciliation_balances to service_role;
grant select on public.bank_account_reconciliation_summaries to service_role;

create or replace function private.prevent_reconciled_payment_reversal()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  reconciliation_total numeric;
begin
  if old.status = 'posted' and new.status = 'reversed' then
    if tg_table_name = 'payments' then
      select round(coalesce(sum(allocation.amount_delta), 0), 4)
      into reconciliation_total
      from public.bank_reconciliation_allocations allocation
      where allocation.workspace_id = old.workspace_id
        and allocation.customer_payment_id = old.id;
    else
      select round(coalesce(sum(allocation.amount_delta), 0), 4)
      into reconciliation_total
      from public.bank_reconciliation_allocations allocation
      where allocation.workspace_id = old.workspace_id
        and allocation.supplier_payment_id = old.id;
    end if;

    if reconciliation_total <> 0 then
      raise exception 'Reverse Bank reconciliation allocations before reversing the Payment';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists payments_prevent_reconciled_reversal on public.payments;
create trigger payments_prevent_reconciled_reversal
before update on public.payments
for each row execute function private.prevent_reconciled_payment_reversal();

drop trigger if exists supplier_payments_prevent_reconciled_reversal on public.supplier_payments;
create trigger supplier_payments_prevent_reconciled_reversal
before update on public.supplier_payments
for each row execute function private.prevent_reconciled_payment_reversal();

revoke all on function private.prevent_reconciled_payment_reversal() from public, anon, authenticated;
grant execute on function private.prevent_reconciled_payment_reversal() to service_role;

commit;
