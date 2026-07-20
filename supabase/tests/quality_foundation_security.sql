begin;

-- Run only against a disposable local or Supabase branch database after all
-- migrations have been applied. The assertions do not persist data and the
-- transaction is rolled back.
do $$
declare
  platform_admin_definition text;
  current_workspace_definition text;
  profile_trigger_definition text;
begin
  if has_table_privilege('anon', 'public.profiles', 'SELECT') then
    raise exception 'anonymous users must not read profiles';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE') then
    raise exception 'authenticated must not update profiles.is_active';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'must_change_password', 'UPDATE') then
    raise exception 'authenticated must not update profiles.must_change_password';
  end if;
  if has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'UPDATE') then
    raise exception 'authenticated must not directly update profiles.updated_at';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE') then
    raise exception 'authenticated should retain safe profile editing';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'active_workspace_id', 'UPDATE') then
    raise exception 'authenticated should retain protected workspace selection';
  end if;

  if to_regprocedure('private.is_active_profile()') is null then
    raise exception 'active-profile authorization helper is missing';
  end if;
  platform_admin_definition := pg_get_functiondef('private.is_platform_admin()'::regprocedure);
  if position('private.is_active_profile()' in platform_admin_definition) = 0 then
    raise exception 'platform administrators must require an active profile';
  end if;
  current_workspace_definition := pg_get_functiondef('private.current_workspace_id()'::regprocedure);
  if position('profile.is_active' in current_workspace_definition) = 0 then
    raise exception 'workspace context must require an active profile';
  end if;

  if to_regprocedure('private.enforce_profile_security_fields()') is null then
    raise exception 'profile security trigger function is missing';
  end if;
  profile_trigger_definition := pg_get_functiondef(
    'private.enforce_profile_security_fields()'::regprocedure
  );
  if position('private.is_platform_admin()' in profile_trigger_definition) > 0 then
    raise exception 'browser Founder sessions must not bypass protected profile fields';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_protect_security_fields'
      and not tgisinternal
  ) then
    raise exception 'profile security trigger is missing';
  end if;

  if has_table_privilege('anon', 'public.activity_items', 'SELECT') then
    raise exception 'anonymous users must not read business activity';
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
  if not has_table_privilege('service_role', 'public.activity_items', 'INSERT') then
    raise exception 'trusted server commands must retain activity insert access';
  end if;
  if exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'activity_items'
      and policyname = 'Activity feature insert'
  ) then
    raise exception 'browser activity insert policy must be removed';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'activity_items'
      and column_name = 'command_id' and data_type = 'uuid'
  ) then
    raise exception 'activity command correlation is missing';
  end if;

  if to_regprocedure('private.enforce_invitation_expiry()') is null then
    raise exception 'invitation expiry guard function is missing';
  end if;
  if not exists (
    select 1 from pg_trigger
    where tgrelid = 'public.workspace_memberships'::regclass
      and tgname = 'workspace_memberships_enforce_invitation_expiry'
      and not tgisinternal
  ) then
    raise exception 'invitation expiry guard trigger is missing';
  end if;
  if exists (
    select 1
    from public.workspace_memberships membership
    where membership.status = 'invited'
      and (
        membership.invitation_last_sent_at is null
        or membership.invitation_expires_at is null
        or membership.invitation_expires_at
          > membership.invitation_last_sent_at + interval '1 hour'
      )
  ) then
    raise exception 'pending invitations must be complete and capped at one hour';
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
