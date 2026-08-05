begin;

select plan(27);

select has_table('public', 'workspace_operational_settings', 'Workspace operational Settings exist');
select has_column('public', 'workspace_operational_settings', 'fiscal_year_start_month', 'Fiscal-year start is stored');
select has_column('public', 'workspace_operational_settings', 'default_export_format', 'Default export format is stored');
select has_column('public', 'workspace_operational_settings', 'archived_records_default', 'Archive visibility default is stored');
select has_column('public', 'workspace_operational_settings', 'appointment_reminders_enabled', 'Appointment reminder policy is stored');
select has_column('public', 'workspace_operational_settings', 'updated_by', 'Operational Settings retain the responsible actor');

select ok(
  (select relrowsecurity from pg_class where oid='public.workspace_operational_settings'::regclass),
  'Workspace operational Settings use RLS'
);
select ok(
  exists(
    select 1 from pg_policies
    where schemaname='public'
      and tablename='workspace_operational_settings'
      and policyname='Members view workspace operational settings'
      and cmd='SELECT'
  ),
  'Members receive an RLS-scoped operational Settings read policy'
);
select ok(has_table_privilege('authenticated','public.workspace_operational_settings','SELECT'), 'Authenticated users can read operational Settings through RLS');
select ok(not has_table_privilege('authenticated','public.workspace_operational_settings','INSERT'), 'Authenticated users cannot insert operational Settings directly');
select ok(not has_table_privilege('authenticated','public.workspace_operational_settings','UPDATE'), 'Authenticated users cannot update operational Settings directly');
select ok(not has_table_privilege('authenticated','public.workspace_operational_settings','DELETE'), 'Authenticated users cannot delete operational Settings directly');
select ok(not has_table_privilege('anon','public.workspace_operational_settings','SELECT'), 'Anonymous users cannot read operational Settings');

select has_function(
  'public',
  'update_workspace_operational_settings',
  array['uuid','uuid','text','text','integer','text','text','boolean','uuid','timestamp with time zone'],
  'Trusted operational Settings command exists'
);
select ok(
  has_function_privilege(
    'service_role',
    'public.update_workspace_operational_settings(uuid,uuid,text,text,integer,text,text,boolean,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'Service role can execute the trusted operational Settings command'
);
select ok(
  not has_function_privilege(
    'authenticated',
    'public.update_workspace_operational_settings(uuid,uuid,text,text,integer,text,text,boolean,uuid,timestamp with time zone)',
    'EXECUTE'
  ),
  'Authenticated browser clients cannot execute the trusted command directly'
);
select ok(
  position('actor_has_workspace_admin_access' in lower(pg_get_functiondef('public.update_workspace_operational_settings(uuid,uuid,text,text,integer,text,text,boolean,uuid,timestamp with time zone)'::regprocedure))) > 0,
  'Operational Settings command independently verifies workspace administration access'
);
select ok(
  position('workspace_recovery_receipts' in lower(pg_get_functiondef('public.update_workspace_operational_settings(uuid,uuid,text,text,integer,text,text,boolean,uuid,timestamp with time zone)'::regprocedure))) > 0,
  'Operational Settings command is idempotent'
);
select ok(
  position('operational settings updated' in lower(pg_get_functiondef('public.update_workspace_operational_settings(uuid,uuid,text,text,integer,text,text,boolean,uuid,timestamp with time zone)'::regprocedure))) > 0,
  'Operational Settings command writes business Activity'
);
select ok(
  position('workspace.operational_settings_updated' in lower(pg_get_functiondef('public.update_workspace_operational_settings(uuid,uuid,text,text,integer,text,text,boolean,uuid,timestamp with time zone)'::regprocedure))) > 0,
  'Operational Settings command writes security audit evidence'
);
select ok(
  position('appointment_reminders_enabled' in lower(pg_get_functiondef('public.due_appointment_reminders()'::regprocedure))) > 0,
  'Reminder selection honours workspace reminder enablement'
);
select ok(
  position('workspace_operational_settings' in lower(pg_get_functiondef('private.workspace_restorable_tables()'::regprocedure))) > 0,
  'Operational Settings are included in the portable snapshot allowlist'
);
select ok(
  position('delete from public.workspace_operational_settings' in lower(pg_get_functiondef('public.restore_workspace_snapshot(uuid,uuid,text,text,jsonb,uuid,timestamp with time zone)'::regprocedure))) > 0,
  'Snapshot restore replaces the existing operational Settings row'
);
select ok(
  not exists(
    select 1 from public.workspaces workspace
    where not exists(
      select 1 from public.workspace_operational_settings settings
      where settings.workspace_id=workspace.id
    )
  ),
  'Existing workspaces have an operational Settings row'
);
select ok(
  not exists(
    select 1 from public.workspace_operational_settings
    where fiscal_year_start_month not between 1 and 12
      or default_export_format not in ('csv','json')
      or archived_records_default not in ('hide','show')
  ),
  'Stored operational Settings satisfy the supported values'
);
select ok(
  exists(
    select 1
    from pg_constraint constraint_row
    where constraint_row.conrelid='public.workspace_recovery_receipts'::regclass
      and constraint_row.contype='c'
      and pg_get_constraintdef(constraint_row.oid) ilike '%update_operations%'
  ),
  'Recovery receipts accept the operational Settings command action'
);
select ok(
  exists(
    select 1 from pg_indexes
    where schemaname='public'
      and indexname='workspace_operational_settings_updated_by_idx'
  ),
  'Operational Settings actor foreign key has a covering index'
);

select * from finish();
rollback;
