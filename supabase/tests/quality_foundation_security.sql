begin;

-- Run only against a disposable local or Supabase branch database after all
-- migrations have been applied. The test is read-only and rolls back.
do $$
begin
  if has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE') then
    raise exception 'authenticated must not update profiles.is_active';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'must_change_password', 'UPDATE') then
    raise exception 'authenticated must not update profiles.must_change_password';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    raise exception 'authenticated should retain safe profile editing';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'active_workspace_id', 'UPDATE') then
    raise exception 'authenticated should retain protected workspace selection';
  end if;

  if to_regprocedure('private.enforce_profile_security_fields()') is null then
    raise exception 'profile security trigger function is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_protect_security_fields'
      and not tgisinternal
  ) then
    raise exception 'profile security trigger is missing';
  end if;

  if has_table_privilege('authenticated', 'public.activity_items', 'INSERT') then
    raise exception 'browser clients must not insert permanent activity directly';
  end if;
  if has_table_privilege('authenticated', 'public.activity_items', 'UPDATE') then
    raise exception 'business activity must be immutable';
  end if;
  if has_table_privilege('authenticated', 'public.activity_items', 'DELETE') then
    raise exception 'business activity must be append-only';
  end if;
  if not has_table_privilege('authenticated', 'public.activity_items', 'SELECT') then
    raise exception 'members should retain RLS-scoped activity reads';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_items'
      and column_name = 'command_id' and data_type = 'uuid'
  ) then
    raise exception 'activity command correlation is missing';
  end if;

  if exists (
    select 1
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname in ('customers','bookings','invoices','documents','messages','bank_transactions','workspaces','workspace_memberships')
      and not c.relrowsecurity
  ) then
    raise exception 'one or more tenant tables do not have RLS enabled';
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'invoices_workspace_id_customer_id_fkey'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id)%'
  ) then
    raise exception 'invoice-to-customer workspace isolation constraint is missing';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bookings_workspace_id_customer_id_fkey'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id)%'
  ) then
    raise exception 'booking-to-customer workspace isolation constraint is missing';
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conname = 'bank_transactions_workspace_id_matched_invoice_id_fkey'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, matched_invoice_id)%'
  ) then
    raise exception 'bank-to-invoice workspace isolation constraint is missing';
  end if;
end;
$$;

rollback;
