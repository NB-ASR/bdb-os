begin;

select plan(27);

select ok(
  not has_table_privilege('anon', 'public.profiles', 'SELECT'),
  'anonymous users cannot read profiles'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'is_active', 'UPDATE'),
  'authenticated users cannot update profiles.is_active'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'must_change_password', 'UPDATE'),
  'authenticated users cannot update profiles.must_change_password'
);
select ok(
  not has_column_privilege('authenticated', 'public.profiles', 'updated_at', 'UPDATE'),
  'authenticated users cannot update profiles.updated_at directly'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE'),
  'authenticated users retain safe full-name editing'
);
select ok(
  has_column_privilege('authenticated', 'public.profiles', 'active_workspace_id', 'UPDATE'),
  'authenticated users retain protected workspace selection'
);

select ok(
  to_regprocedure('private.is_active_profile()') is not null,
  'active-profile authorization helper exists'
);
select ok(
  position(
    'private.is_active_profile()' in
    pg_get_functiondef('private.is_platform_admin()'::regprocedure)
  ) > 0,
  'platform administration requires an active profile'
);
select ok(
  position(
    'profile.is_active' in
    pg_get_functiondef('private.current_workspace_id()'::regprocedure)
  ) > 0,
  'workspace context requires an active profile'
);
select ok(
  to_regprocedure('private.enforce_profile_security_fields()') is not null,
  'profile security trigger function exists'
);
select ok(
  position(
    'private.is_platform_admin()' in
    pg_get_functiondef('private.enforce_profile_security_fields()'::regprocedure)
  ) = 0,
  'browser Founder sessions do not bypass protected profile columns'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and tgname = 'profiles_protect_security_fields'
      and not tgisinternal
  ),
  'profile security trigger exists'
);

select ok(
  not has_table_privilege('anon', 'public.activity_items', 'SELECT'),
  'anonymous users cannot read business activity'
);
select ok(
  not has_table_privilege('authenticated', 'public.activity_items', 'INSERT'),
  'browser clients cannot insert permanent activity'
);
select ok(
  not has_table_privilege('authenticated', 'public.activity_items', 'UPDATE'),
  'business activity is immutable from browser clients'
);
select ok(
  not has_table_privilege('authenticated', 'public.activity_items', 'DELETE'),
  'business activity is append-only from browser clients'
);
select ok(
  has_table_privilege('authenticated', 'public.activity_items', 'SELECT'),
  'members retain RLS-scoped activity reads'
);
select ok(
  has_table_privilege('service_role', 'public.activity_items', 'INSERT'),
  'trusted server commands retain activity insert access'
);
select ok(
  not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'activity_items'
      and policyname = 'Activity feature insert'
  ),
  'browser activity insert policy is removed'
);
select ok(
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'activity_items'
      and column_name = 'command_id'
      and data_type = 'uuid'
  ),
  'activity command correlation column exists'
);

select ok(
  to_regprocedure('private.enforce_invitation_expiry()') is not null,
  'invitation expiry guard function exists'
);
select ok(
  exists (
    select 1 from pg_trigger
    where tgrelid = 'public.workspace_memberships'::regclass
      and tgname = 'workspace_memberships_enforce_invitation_expiry'
      and not tgisinternal
  ),
  'invitation expiry guard trigger exists'
);
select ok(
  not exists (
    select 1
    from public.workspace_memberships membership
    where membership.status = 'invited'
      and (
        membership.invitation_last_sent_at is null
        or membership.invitation_expires_at is null
        or membership.invitation_expires_at
          > membership.invitation_last_sent_at + interval '1 hour'
      )
  ),
  'pending invitations are complete and capped at one hour'
);

select ok(
  not exists (
    select 1
    from pg_class relation
    join pg_namespace namespace on namespace.oid = relation.relnamespace
    where namespace.nspname = 'public'
      and relation.relname in (
        'customers',
        'bookings',
        'invoices',
        'documents',
        'messages',
        'bank_transactions',
        'workspaces',
        'workspace_memberships'
      )
      and not relation.relrowsecurity
  ),
  'tenant tables have RLS enabled'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'invoices_workspace_id_customer_id_fkey'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id)%'
  ),
  'invoice-to-customer workspace isolation constraint exists'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'bookings_workspace_id_customer_id_fkey'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, customer_id)%'
  ),
  'booking-to-customer workspace isolation constraint exists'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conname = 'bank_transactions_workspace_id_matched_invoice_id_fkey'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (workspace_id, matched_invoice_id)%'
  ),
  'bank-to-invoice workspace isolation constraint exists'
);

select * from finish();
rollback;
