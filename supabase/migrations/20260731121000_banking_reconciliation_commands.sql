begin;

create or replace function private.banking_actor_can_write(
  target_workspace_id uuid,
  target_actor_user_id uuid,
  target_action text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.actor_has_workspace_permission(
    target_workspace_id,
    target_actor_user_id,
    'banking',
    target_action
  );
$$;

revoke all on function private.banking_actor_can_write(uuid, uuid, text) from public, anon, authenticated;
grant execute on function private.banking_actor_can_write(uuid, uuid, text) to service_role;

create or replace function public.create_bank_account(
  p_workspace_id uuid,
  p_bank_account_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_code text,
  p_display_name text,
  p_institution_name text,
  p_masked_identifier text,
  p_currency text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  account_record public.bank_accounts;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
    raise exception 'Bank account creation access denied';
  end if;
  if p_idempotency_key is null or char_length(trim(p_idempotency_key)) not between 1 and 128 then
    raise exception 'Bank account idempotency key is invalid';
  end if;
  if p_code is null or char_length(trim(p_code)) not between 2 and 32 then
    raise exception 'Bank account code is invalid';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 2 and 120 then
    raise exception 'Bank account name is invalid';
  end if;
  if p_institution_name is null or char_length(trim(p_institution_name)) not between 2 and 160 then
    raise exception 'Bank institution name is invalid';
  end if;
  if p_masked_identifier is not null
     and char_length(trim(p_masked_identifier)) not between 2 and 80 then
    raise exception 'Bank account identifier is invalid';
  end if;
  if p_currency is null or upper(trim(p_currency)) !~ '^[A-Z]{3}$' then
    raise exception 'Bank account currency is invalid';
  end if;
  if exists (select 1 from public.bank_accounts account where account.id = p_bank_account_id) then
    raise exception 'Bank account identity conflict';
  end if;

  insert into public.bank_accounts (
    id, workspace_id, code, display_name, institution_name,
    masked_identifier, currency, created_by, updated_by
  ) values (
    p_bank_account_id,
    p_workspace_id,
    upper(trim(p_code)),
    trim(p_display_name),
    trim(p_institution_name),
    nullif(trim(p_masked_identifier), ''),
    upper(trim(p_currency)),
    p_actor_user_id,
    p_actor_user_id
  )
  returning * into account_record;

  command_result := jsonb_build_object(
    'action', 'create_bank_account',
    'bankAccount', to_jsonb(account_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'bank_account', account_record.id,
    'create_bank_account', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank account created',
    account_record.display_name || ' · ' || account_record.currency, 'blue',
    'bank_account', account_record.id::text, p_command_id,
    jsonb_build_object('code', account_record.code, 'institution', account_record.institution_name)
  );

  return command_result;
end;
$$;

create or replace function public.update_bank_account(
  p_workspace_id uuid,
  p_bank_account_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_display_name text,
  p_institution_name text,
  p_masked_identifier text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  account_record public.bank_accounts;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'edit') then
    raise exception 'Bank account update access denied';
  end if;
  if p_display_name is null or char_length(trim(p_display_name)) not between 2 and 120 then
    raise exception 'Bank account name is invalid';
  end if;
  if p_institution_name is null or char_length(trim(p_institution_name)) not between 2 and 160 then
    raise exception 'Bank institution name is invalid';
  end if;
  if p_masked_identifier is not null
     and char_length(trim(p_masked_identifier)) not between 2 and 80 then
    raise exception 'Bank account identifier is invalid';
  end if;

  update public.bank_accounts account
  set display_name = trim(p_display_name),
      institution_name = trim(p_institution_name),
      masked_identifier = nullif(trim(p_masked_identifier), ''),
      updated_by = p_actor_user_id,
      updated_at = now(),
      version = account.version + 1
  where account.workspace_id = p_workspace_id
    and account.id = p_bank_account_id
    and account.version = p_expected_version
    and account.status = 'active'
  returning * into account_record;

  if account_record.id is null then
    if not exists (
      select 1 from public.bank_accounts account
      where account.workspace_id = p_workspace_id and account.id = p_bank_account_id
    ) then raise exception 'Bank account not found'; end if;
    raise exception 'Bank account changed before this update was applied';
  end if;

  command_result := jsonb_build_object(
    'action', 'update_bank_account',
    'bankAccount', to_jsonb(account_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'bank_account', account_record.id,
    'update_bank_account', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank account updated',
    account_record.display_name, 'neutral',
    'bank_account', account_record.id::text, p_command_id,
    jsonb_build_object('version', account_record.version)
  );

  return command_result;
end;
$$;

create or replace function public.archive_bank_account(
  p_workspace_id uuid,
  p_bank_account_id uuid,
  p_expected_version integer,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  account_record public.bank_accounts;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'delete') then
    raise exception 'Bank account archive access denied';
  end if;

  update public.bank_accounts account
  set status = 'archived',
      updated_by = p_actor_user_id,
      updated_at = now(),
      version = account.version + 1
  where account.workspace_id = p_workspace_id
    and account.id = p_bank_account_id
    and account.version = p_expected_version
    and account.status = 'active'
  returning * into account_record;

  if account_record.id is null then
    if not exists (
      select 1 from public.bank_accounts account
      where account.workspace_id = p_workspace_id and account.id = p_bank_account_id
    ) then raise exception 'Bank account not found'; end if;
    raise exception 'Bank account changed before it could be archived';
  end if;

  command_result := jsonb_build_object(
    'action', 'archive_bank_account',
    'bankAccount', to_jsonb(account_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'bank_account', account_record.id,
    'archive_bank_account', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank account archived',
    account_record.display_name, 'gold',
    'bank_account', account_record.id::text, p_command_id, '{}'::jsonb
  );

  return command_result;
end;
$$;

create or replace function public.import_bank_statement(
  p_workspace_id uuid,
  p_statement_import_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_bank_account_id uuid,
  p_source_filename text,
  p_source_file_hash text,
  p_rows jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  account_record public.bank_accounts;
  import_record public.bank_statement_imports;
  row_value jsonb;
  transaction_id uuid;
  transaction_date_value date;
  value_date_value date;
  description_value text;
  amount_value numeric;
  transaction_type_value text;
  currency_value text;
  external_reference_value text;
  fingerprint_value text;
  source_row_number_value integer;
  imported_count_value integer := 0;
  duplicate_count_value integer := 0;
  period_start_value date;
  period_end_value date;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'create') then
    raise exception 'Bank statement import access denied';
  end if;
  if p_source_filename is null or char_length(trim(p_source_filename)) not between 1 and 255 then
    raise exception 'Bank statement filename is invalid';
  end if;
  if p_source_file_hash is null or lower(trim(p_source_file_hash)) !~ '^[0-9a-f]{64}$' then
    raise exception 'Bank statement file hash is invalid';
  end if;
  if p_rows is null or jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 then
    raise exception 'Bank statement contains no transactions';
  end if;
  if jsonb_array_length(p_rows) > 5000 then
    raise exception 'Bank statement exceeds the Version 1 import limit';
  end if;

  select * into account_record
  from public.bank_accounts account
  where account.workspace_id = p_workspace_id
    and account.id = p_bank_account_id
    and account.status = 'active'
  for update;
  if account_record.id is null then raise exception 'Bank account is unavailable'; end if;

  if exists (
    select 1 from public.bank_statement_imports statement_import
    where statement_import.workspace_id = p_workspace_id
      and statement_import.bank_account_id = p_bank_account_id
      and statement_import.source_file_hash = lower(trim(p_source_file_hash))
  ) then
    raise exception 'This Bank statement file has already been imported';
  end if;
  if exists (
    select 1 from public.bank_statement_imports statement_import
    where statement_import.id = p_statement_import_id
  ) then
    raise exception 'Bank statement import identity conflict';
  end if;

  insert into public.bank_statement_imports (
    id, workspace_id, bank_account_id, source_filename, source_file_hash,
    imported_by
  ) values (
    p_statement_import_id, p_workspace_id, p_bank_account_id,
    trim(p_source_filename), lower(trim(p_source_file_hash)), p_actor_user_id
  )
  returning * into import_record;

  for row_value in select value from jsonb_array_elements(p_rows)
  loop
    begin
      transaction_id := (row_value ->> 'id')::uuid;
      transaction_date_value := (row_value ->> 'transactionDate')::date;
      value_date_value := nullif(row_value ->> 'valueDate', '')::date;
      description_value := trim(row_value ->> 'description');
      amount_value := round((row_value ->> 'amount')::numeric, 4);
      transaction_type_value := trim(row_value ->> 'transactionType');
      currency_value := upper(trim(row_value ->> 'currency'));
      external_reference_value := nullif(trim(row_value ->> 'externalReference'), '');
      fingerprint_value := lower(trim(row_value ->> 'fingerprint'));
      source_row_number_value := (row_value ->> 'sourceRowNumber')::integer;
    exception when others then
      raise exception 'Bank statement row % is invalid', coalesce(row_value ->> 'sourceRowNumber', '?');
    end;

    if description_value is null or char_length(description_value) not between 1 and 500 then
      raise exception 'Bank statement row % has an invalid description', source_row_number_value;
    end if;
    if amount_value is null or amount_value <= 0 then
      raise exception 'Bank statement row % has an invalid amount', source_row_number_value;
    end if;
    if transaction_type_value not in ('credit', 'debit') then
      raise exception 'Bank statement row % has an invalid direction', source_row_number_value;
    end if;
    if currency_value <> account_record.currency then
      raise exception 'Bank statement row % currency does not match the Bank account', source_row_number_value;
    end if;
    if fingerprint_value !~ '^[0-9a-f]{64}$' then
      raise exception 'Bank statement row % has an invalid fingerprint', source_row_number_value;
    end if;
    if source_row_number_value <= 0 then
      raise exception 'Bank statement row number is invalid';
    end if;
    if external_reference_value is not null and char_length(external_reference_value) > 200 then
      raise exception 'Bank statement row % reference is too long', source_row_number_value;
    end if;

    if exists (
      select 1 from public.bank_transactions transaction
      where transaction.workspace_id = p_workspace_id
        and transaction.bank_account_id = p_bank_account_id
        and transaction.fingerprint = fingerprint_value
    ) then
      duplicate_count_value := duplicate_count_value + 1;
      continue;
    end if;

    if exists (select 1 from public.bank_transactions transaction where transaction.id = transaction_id) then
      raise exception 'Bank transaction identity conflict';
    end if;

    insert into public.bank_transactions (
      id,
      workspace_id,
      transaction_date,
      description,
      amount,
      transaction_type,
      status,
      bank_account_id,
      statement_import_id,
      currency,
      external_reference,
      fingerprint,
      value_date,
      source_row_number,
      imported_by,
      record_status
    ) values (
      transaction_id,
      p_workspace_id,
      transaction_date_value,
      description_value,
      amount_value,
      transaction_type_value,
      'unmatched',
      p_bank_account_id,
      p_statement_import_id,
      currency_value,
      external_reference_value,
      fingerprint_value,
      value_date_value,
      source_row_number_value,
      p_actor_user_id,
      'posted'
    );

    imported_count_value := imported_count_value + 1;
    period_start_value := least(coalesce(period_start_value, transaction_date_value), transaction_date_value);
    period_end_value := greatest(coalesce(period_end_value, transaction_date_value), transaction_date_value);
  end loop;

  update public.bank_statement_imports
  set period_start = period_start_value,
      period_end = period_end_value,
      imported_count = imported_count_value,
      duplicate_count = duplicate_count_value,
      rejected_count = 0,
      review_count = imported_count_value
  where workspace_id = p_workspace_id
    and id = p_statement_import_id
  returning * into import_record;

  command_result := jsonb_build_object(
    'action', 'import_bank_statement',
    'statementImport', to_jsonb(import_record),
    'importedCount', imported_count_value,
    'duplicateCount', duplicate_count_value
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'statement_import', import_record.id,
    'import_bank_statement', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank statement imported',
    import_record.source_filename || ' · ' || imported_count_value || ' transaction(s)', 'blue',
    'bank_statement_import', import_record.id::text, p_command_id,
    jsonb_build_object(
      'bank_account_id', p_bank_account_id,
      'imported_count', imported_count_value,
      'duplicate_count', duplicate_count_value
    )
  );

  return command_result;
end;
$$;

create or replace function public.reconcile_bank_transaction(
  p_workspace_id uuid,
  p_allocation_id uuid,
  p_bank_transaction_id uuid,
  p_target_type text,
  p_target_payment_id uuid,
  p_amount numeric,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  transaction_record public.bank_transactions;
  customer_payment_record public.payments;
  supplier_payment_record public.supplier_payments;
  transaction_allocated numeric;
  payment_allocated numeric;
  available_transaction numeric;
  available_payment numeric;
  allocation_record public.bank_reconciliation_allocations;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Bank reconciliation access denied';
  end if;
  if p_target_type not in ('customer_payment', 'supplier_payment') then
    raise exception 'Bank reconciliation target type is invalid';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Bank reconciliation amount must be greater than zero';
  end if;
  if exists (
    select 1 from public.bank_reconciliation_allocations allocation
    where allocation.id = p_allocation_id
  ) then
    raise exception 'Bank reconciliation identity conflict';
  end if;

  select * into transaction_record
  from public.bank_transactions transaction
  where transaction.workspace_id = p_workspace_id
    and transaction.id = p_bank_transaction_id
  for update;
  if transaction_record.id is null then raise exception 'Bank transaction not found'; end if;
  if transaction_record.record_status <> 'posted' then
    raise exception 'Bank transaction is unavailable for reconciliation';
  end if;
  if transaction_record.bank_account_id is null or transaction_record.currency is null then
    raise exception 'Legacy Bank transaction must be reviewed before reconciliation';
  end if;

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into transaction_allocated
  from public.bank_reconciliation_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.bank_transaction_id = p_bank_transaction_id;

  available_transaction := greatest(round(transaction_record.amount - transaction_allocated, 4), 0);

  if p_target_type = 'customer_payment' then
    if transaction_record.transaction_type <> 'credit' then
      raise exception 'Money received can only reconcile to a Customer Payment';
    end if;

    select * into customer_payment_record
    from public.payments payment
    where payment.workspace_id = p_workspace_id
      and payment.id = p_target_payment_id
    for update;
    if customer_payment_record.id is null then raise exception 'Customer Payment not found'; end if;
    if customer_payment_record.status <> 'posted' then
      raise exception 'Customer Payment is unavailable for reconciliation';
    end if;
    if customer_payment_record.currency <> transaction_record.currency then
      raise exception 'Bank transaction and Customer Payment currencies must match';
    end if;

    select round(coalesce(sum(allocation.amount_delta), 0), 4)
    into payment_allocated
    from public.bank_reconciliation_allocations allocation
    where allocation.workspace_id = p_workspace_id
      and allocation.customer_payment_id = p_target_payment_id;

    available_payment := greatest(round(customer_payment_record.amount - payment_allocated, 4), 0);
  else
    if transaction_record.transaction_type <> 'debit' then
      raise exception 'Money sent can only reconcile to a Supplier Payment';
    end if;

    select * into supplier_payment_record
    from public.supplier_payments payment
    where payment.workspace_id = p_workspace_id
      and payment.id = p_target_payment_id
    for update;
    if supplier_payment_record.id is null then raise exception 'Supplier Payment not found'; end if;
    if supplier_payment_record.status <> 'posted' then
      raise exception 'Supplier Payment is unavailable for reconciliation';
    end if;
    if supplier_payment_record.currency <> transaction_record.currency then
      raise exception 'Bank transaction and Supplier Payment currencies must match';
    end if;

    select round(coalesce(sum(allocation.amount_delta), 0), 4)
    into payment_allocated
    from public.bank_reconciliation_allocations allocation
    where allocation.workspace_id = p_workspace_id
      and allocation.supplier_payment_id = p_target_payment_id;

    available_payment := greatest(round(supplier_payment_record.amount - payment_allocated, 4), 0);
  end if;

  if round(p_amount, 4) > available_transaction then
    raise exception 'Bank reconciliation exceeds the unmatched Bank transaction amount';
  end if;
  if round(p_amount, 4) > available_payment then
    raise exception 'Bank reconciliation exceeds the unreconciled Payment amount';
  end if;

  insert into public.bank_reconciliation_allocations (
    id,
    workspace_id,
    bank_transaction_id,
    customer_payment_id,
    supplier_payment_id,
    allocation_type,
    amount_delta,
    actor_user_id,
    command_id,
    occurred_at
  ) values (
    p_allocation_id,
    p_workspace_id,
    p_bank_transaction_id,
    case when p_target_type = 'customer_payment' then p_target_payment_id else null end,
    case when p_target_type = 'supplier_payment' then p_target_payment_id else null end,
    'allocation',
    round(p_amount, 4),
    p_actor_user_id,
    p_command_id,
    coalesce(p_occurred_at, now())
  )
  returning * into allocation_record;

  command_result := jsonb_build_object(
    'action', 'reconcile_bank_transaction',
    'allocation', to_jsonb(allocation_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'reconciliation', allocation_record.id,
    'reconcile_bank_transaction', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank transaction reconciled',
    transaction_record.description || ' · ' || round(p_amount, 4), 'green',
    'bank_reconciliation', allocation_record.id::text, p_command_id,
    jsonb_build_object(
      'bank_transaction_id', transaction_record.id,
      'target_type', p_target_type,
      'target_payment_id', p_target_payment_id,
      'amount', allocation_record.amount_delta
    )
  );

  return command_result;
end;
$$;

create or replace function public.reverse_bank_reconciliation(
  p_workspace_id uuid,
  p_reversal_id uuid,
  p_allocation_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_reason text,
  p_occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  original_record public.bank_reconciliation_allocations;
  reversal_record public.bank_reconciliation_allocations;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'approve') then
    raise exception 'Bank reconciliation reversal access denied';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Bank reconciliation reversal reason is invalid';
  end if;

  select * into original_record
  from public.bank_reconciliation_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.id = p_allocation_id
  for update;
  if original_record.id is null then raise exception 'Bank reconciliation allocation not found'; end if;
  if original_record.allocation_type <> 'allocation' then
    raise exception 'Only original Bank reconciliation allocations can be reversed';
  end if;
  if exists (
    select 1 from public.bank_reconciliation_allocations allocation
    where allocation.workspace_id = p_workspace_id
      and allocation.reversal_of_id = p_allocation_id
  ) then
    raise exception 'Bank reconciliation allocation has already been reversed';
  end if;

  insert into public.bank_reconciliation_allocations (
    id, workspace_id, bank_transaction_id, customer_payment_id, supplier_payment_id,
    allocation_type, amount_delta, reversal_of_id, reason,
    actor_user_id, command_id, occurred_at
  ) values (
    p_reversal_id, p_workspace_id, original_record.bank_transaction_id,
    original_record.customer_payment_id, original_record.supplier_payment_id,
    'reversal', -original_record.amount_delta, original_record.id, trim(p_reason),
    p_actor_user_id, p_command_id, coalesce(p_occurred_at, now())
  )
  returning * into reversal_record;

  command_result := jsonb_build_object(
    'action', 'reverse_bank_reconciliation',
    'allocation', to_jsonb(reversal_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'reconciliation', reversal_record.id,
    'reverse_bank_reconciliation', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank reconciliation reversed',
    trim(p_reason), 'gold',
    'bank_reconciliation', reversal_record.id::text, p_command_id,
    jsonb_build_object(
      'reversal_of_id', original_record.id,
      'bank_transaction_id', original_record.bank_transaction_id,
      'amount', reversal_record.amount_delta
    )
  );

  return command_result;
end;
$$;

create or replace function public.reverse_bank_transaction(
  p_workspace_id uuid,
  p_bank_transaction_id uuid,
  p_idempotency_key text,
  p_actor_user_id uuid,
  p_command_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  previous_result jsonb;
  transaction_record public.bank_transactions;
  reconciliation_total numeric;
  command_result jsonb;
begin
  select receipt.result into previous_result
  from public.banking_command_receipts receipt
  where receipt.workspace_id = p_workspace_id
    and receipt.idempotency_key = p_idempotency_key;
  if previous_result is not null then return previous_result; end if;

  if not private.banking_actor_can_write(p_workspace_id, p_actor_user_id, 'delete') then
    raise exception 'Bank transaction reversal access denied';
  end if;
  if p_reason is null or char_length(trim(p_reason)) not between 5 and 500 then
    raise exception 'Bank transaction reversal reason is invalid';
  end if;

  select * into transaction_record
  from public.bank_transactions transaction
  where transaction.workspace_id = p_workspace_id
    and transaction.id = p_bank_transaction_id
  for update;
  if transaction_record.id is null then raise exception 'Bank transaction not found'; end if;
  if transaction_record.record_status <> 'posted' then
    raise exception 'Bank transaction has already been reversed';
  end if;

  select round(coalesce(sum(allocation.amount_delta), 0), 4)
  into reconciliation_total
  from public.bank_reconciliation_allocations allocation
  where allocation.workspace_id = p_workspace_id
    and allocation.bank_transaction_id = p_bank_transaction_id;
  if reconciliation_total <> 0 then
    raise exception 'Reverse Bank reconciliation allocations before reversing the Bank transaction';
  end if;

  update public.bank_transactions
  set record_status = 'reversed',
      reversed_at = now(),
      reversed_by = p_actor_user_id,
      reversal_reason = trim(p_reason),
      version = version + 1
  where workspace_id = p_workspace_id
    and id = p_bank_transaction_id
  returning * into transaction_record;

  command_result := jsonb_build_object(
    'action', 'reverse_bank_transaction',
    'bankTransaction', to_jsonb(transaction_record)
  );

  insert into public.banking_command_receipts (
    workspace_id, idempotency_key, entity_type, entity_id, action, result
  ) values (
    p_workspace_id, trim(p_idempotency_key), 'bank_transaction', transaction_record.id,
    'reverse_bank_transaction', command_result
  );

  insert into public.activity_items (
    workspace_id, actor_user_id, action, detail, tone,
    entity_type, entity_id, command_id, metadata
  ) values (
    p_workspace_id, p_actor_user_id, 'Bank transaction reversed',
    trim(p_reason), 'gold',
    'bank_transaction', transaction_record.id::text, p_command_id,
    jsonb_build_object(
      'transaction_type', transaction_record.transaction_type,
      'amount', transaction_record.amount,
      'currency', transaction_record.currency
    )
  );

  return command_result;
end;
$$;

revoke all on function public.create_bank_account(uuid, uuid, text, uuid, uuid, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.update_bank_account(uuid, uuid, integer, text, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.archive_bank_account(uuid, uuid, integer, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.import_bank_statement(uuid, uuid, text, uuid, uuid, uuid, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.reconcile_bank_transaction(uuid, uuid, uuid, text, uuid, numeric, text, uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.reverse_bank_reconciliation(uuid, uuid, uuid, text, uuid, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.reverse_bank_transaction(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.create_bank_account(uuid, uuid, text, uuid, uuid, text, text, text, text, text) to service_role;
grant execute on function public.update_bank_account(uuid, uuid, integer, text, uuid, uuid, text, text, text) to service_role;
grant execute on function public.archive_bank_account(uuid, uuid, integer, text, uuid, uuid) to service_role;
grant execute on function public.import_bank_statement(uuid, uuid, text, uuid, uuid, uuid, text, text, jsonb) to service_role;
grant execute on function public.reconcile_bank_transaction(uuid, uuid, uuid, text, uuid, numeric, text, uuid, uuid, timestamptz) to service_role;
grant execute on function public.reverse_bank_reconciliation(uuid, uuid, uuid, text, uuid, uuid, text, timestamptz) to service_role;
grant execute on function public.reverse_bank_transaction(uuid, uuid, text, uuid, uuid, text) to service_role;

commit;
