begin;

select plan(10);

select has_table('public', 'sector_packs', 'Sector Pack catalogue exists');
select has_table('public', 'workspace_sector_configs', 'Workspace Sector Pack configuration exists');
select col_is_pk('public', 'workspace_sector_configs', 'workspace_id', 'Each workspace has one Sector Pack configuration');
select is(
  (select relrowsecurity from pg_class where oid = 'public.sector_packs'::regclass),
  true,
  'Sector Pack catalogue has RLS enabled'
);
select is(
  (select relrowsecurity from pg_class where oid = 'public.workspace_sector_configs'::regclass),
  true,
  'Workspace Sector Pack configuration has RLS enabled'
);
select has_policy(
  'public',
  'workspace_sector_configs',
  'Workspace members can read published sector configuration',
  'Published client configuration is protected by a workspace membership policy'
);
select is(
  (select count(*) from public.sector_packs where is_active),
  5::bigint,
  'Five launch Sector Packs are seeded'
);
select is(
  (select count(*) from public.sector_packs where key = 'general-services' and version = 1),
  1::bigint,
  'General Services fallback pack exists exactly once'
);
select ok(
  exists(
    select 1
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname = 'provision_default_sector_config'
  ),
  'Default Sector Pack provisioning function exists'
);
select ok(
  exists(
    select 1
    from pg_trigger
    where tgname = 'workspaces_provision_default_sector_config'
      and not tgisinternal
  ),
  'New workspaces receive a default Sector Pack configuration'
);

select * from finish();
rollback;
