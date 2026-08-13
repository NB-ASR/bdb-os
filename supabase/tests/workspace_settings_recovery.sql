begin;

select plan(51);

select has_table('public', 'workspace_recovery_receipts', 'Workspace recovery receipts exist');
select has_function('private', 'actor_has_workspace_admin_access', array['uuid','uuid','text'], 'Workspace administration access helper exists');
select has_function('private', 'workspace_restorable_tables', array[]::text[], 'Restorable table allowlist exists');
select has_function('private', 'workspace_restorable_record_count', array['uuid','uuid'], 'Restorable record counter exists');
select has_function('public', 'get_workspace_settings_access', array['uuid'], 'Settings access function exists');
select has_function(
  'public', 'update_workspace_configuration',
  array['uuid','uuid','text','text','text','text','text','text','text','text','text','numeric','text','jsonb','uuid','timestamp with time zone'],
  'Trusted workspace configuration command exists'
);
select has_function(
  'public', 'set_workspace_logo',
  array['uuid','uuid','text','text','text','uuid','timestamp with time zone'],
  'Trusted workspace logo command exists'
);
select has_function(
  'public', 'export_workspace_snapshot',
  array['uuid','uuid','timestamp with time zone'],
  'Trusted workspace export command exists'
);
select has_function(
  'public', 'restore_workspace_snapshot',
  array['uuid','uuid','text','text','jsonb','uuid','timestamp with time zone'],
  'Trusted workspace restore command exists'
);

select ok((select relrowsecurity from pg_class where oid='public.workspace_recovery_receipts'::regclass), 'Recovery receipts use RLS');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='workspace_recovery_receipts'), 'Recovery receipts expose no browser policy');
select ok(not (select prosecdef from pg_proc where oid='public.get_workspace_settings_access(uuid)'::regprocedure), 'Settings access does not elevate caller privileges');
select ok(has_function_privilege('authenticated','public.get_workspace_settings_access(uuid)','EXECUTE'), 'Authenticated users can resolve Settings access');
select ok(not has_function_privilege('anon','public.get_workspace_settings_access(uuid)','EXECUTE'), 'Anonymous users cannot resolve Settings access');

select ok(has_table_privilege('authenticated','public.workspace_settings','SELECT'), 'Authenticated users retain RLS-scoped Settings reads');
select ok(has_table_privilege('authenticated','public.workspace_themes','SELECT'), 'Authenticated users retain RLS-scoped Theme reads');
select ok(has_table_privilege('authenticated','public.workspaces','SELECT'), 'Authenticated users retain RLS-scoped Workspace reads');
select ok(not has_table_privilege('authenticated','public.workspace_settings','INSERT'), 'Browser clients cannot insert Settings');
select ok(not has_table_privilege('authenticated','public.workspace_settings','UPDATE'), 'Browser clients cannot update Settings');
select ok(not has_table_privilege('authenticated','public.workspace_settings','DELETE'), 'Browser clients cannot delete Settings');
select ok(not has_table_privilege('authenticated','public.workspace_themes','INSERT'), 'Browser clients cannot insert Themes');
select ok(not has_table_privilege('authenticated','public.workspace_themes','UPDATE'), 'Browser clients cannot update Themes');
select ok(not has_table_privilege('authenticated','public.workspace_themes','DELETE'), 'Browser clients cannot delete Themes');
select ok(not has_table_privilege('authenticated','public.workspaces','UPDATE'), 'Browser clients cannot update Workspaces');
select ok(not has_table_privilege('authenticated','public.workspace_recovery_receipts','SELECT'), 'Browser clients cannot read recovery receipts');
select ok(not has_table_privilege('authenticated','public.workspace_recovery_receipts','INSERT'), 'Browser clients cannot insert recovery receipts');

select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Managers can upload workspace assets'), 'Browser logo upload policy is removed');
select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Managers can update workspace assets'), 'Browser logo replacement policy is removed');
select ok(not exists(select 1 from pg_policies where schemaname='storage' and tablename='objects' and policyname='Managers can delete workspace assets'), 'Browser logo deletion policy is removed');

select ok(has_function_privilege('service_role','public.update_workspace_configuration(uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,jsonb,uuid,timestamp with time zone)','EXECUTE'), 'Service role can update configuration');
select ok(has_function_privilege('service_role','public.set_workspace_logo(uuid,uuid,text,text,text,uuid,timestamp with time zone)','EXECUTE'), 'Service role can set workspace logo');
select ok(has_function_privilege('service_role','public.export_workspace_snapshot(uuid,uuid,timestamp with time zone)','EXECUTE'), 'Service role can export workspace snapshots');
select ok(has_function_privilege('service_role','public.restore_workspace_snapshot(uuid,uuid,text,text,jsonb,uuid,timestamp with time zone)','EXECUTE'), 'Service role can restore workspace snapshots');
select ok(not has_function_privilege('authenticated','public.update_workspace_configuration(uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,jsonb,uuid,timestamp with time zone)','EXECUTE'), 'Authenticated clients cannot update configuration directly');
select ok(not has_function_privilege('authenticated','public.set_workspace_logo(uuid,uuid,text,text,text,uuid,timestamp with time zone)','EXECUTE'), 'Authenticated clients cannot set logos directly');
select ok(not has_function_privilege('authenticated','public.export_workspace_snapshot(uuid,uuid,timestamp with time zone)','EXECUTE'), 'Authenticated clients cannot export snapshots directly');
select ok(not has_function_privilege('authenticated','public.restore_workspace_snapshot(uuid,uuid,text,text,jsonb,uuid,timestamp with time zone)','EXECUTE'), 'Authenticated clients cannot restore snapshots directly');

select ok(position('workspace_recovery_receipts' in lower(pg_get_functiondef('public.update_workspace_configuration(uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,jsonb,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Configuration command is idempotent');
select ok(position('pg_timezone_names' in lower(pg_get_functiondef('public.update_workspace_configuration(uuid,uuid,text,text,text,text,text,text,text,text,text,numeric,text,jsonb,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Configuration validates the workspace timezone');
select ok(position('storage.objects' in lower(pg_get_functiondef('public.set_workspace_logo(uuid,uuid,text,text,text,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Logo command validates the uploaded object');
select ok(position('/branding/' in lower(pg_get_functiondef('public.set_workspace_logo(uuid,uuid,text,text,text,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Logo path remains workspace branding scoped');

select ok(position('workspace memberships' in lower(pg_get_functiondef('public.export_workspace_snapshot(uuid,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Snapshot explicitly excludes memberships');
select ok(position('billing and subscriptions' in lower(pg_get_functiondef('public.export_workspace_snapshot(uuid,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Snapshot explicitly excludes billing');
select ok(position('storage_manifest' in lower(pg_get_functiondef('public.export_workspace_snapshot(uuid,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Snapshot exports a Storage manifest');
select ok(position('workspace_memberships' in lower(pg_get_functiondef('private.workspace_restorable_tables()'::regprocedure))) = 0, 'Memberships are not restorable');
select ok(position('subscriptions' in lower(pg_get_functiondef('private.workspace_restorable_tables()'::regprocedure))) = 0, 'Subscriptions are not restorable');

select ok(position('empty operational workspace' in lower(pg_get_functiondef('public.restore_workspace_snapshot(uuid,uuid,text,text,jsonb,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Restore rejects non-empty workspaces');
select ok(position('storage.objects' in lower(pg_get_functiondef('public.restore_workspace_snapshot(uuid,uuid,text,text,jsonb,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Restore verifies Storage references');
select ok(position('workspaceid' in lower(pg_get_functiondef('public.restore_workspace_snapshot(uuid,uuid,text,text,jsonb,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Restore verifies workspace identity');
select ok(position('jsonb_populate_recordset' in lower(pg_get_functiondef('public.restore_workspace_snapshot(uuid,uuid,text,text,jsonb,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Restore uses typed table records');
select ok(position('workspace_recovery_receipts' in lower(pg_get_functiondef('public.restore_workspace_snapshot(uuid,uuid,text,text,jsonb,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Restore is idempotent');

select * from finish();
rollback;
