begin;

select plan(10);

select ok(
  to_regclass('public.sector_packs') is not null,
  'Sector Pack catalogue exists'
);
select ok(
  to_regclass('public.workspace_sector_configs') is not null,
  'Workspace Sector Pack configuration exists'
);
select ok(
  exists (
    select 1
    from pg_constraint
    where conrelid = 'public.workspace_sector_configs'::regclass
      and contype = 'p'
      and pg_get_constraintdef(oid) = 'PRIMARY KEY (workspace_id)'
  ),
  'Each workspace has one Sector Pack configuration'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.sector_packs'::regclass),
  'Sector Pack catalogue has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.workspace_sector_configs'::regclass),
  'Workspace Sector Pack configuration has RLS enabled'
);
select ok(
  exists (
    select 1
    from pg_policies
    where schemaname = 'public'
      and tablename = 'workspace_sector_configs'
      and policyname = 'Workspace members can read published sector configuration'
      and cmd = 'SELECT'
  ),
  'Published client configuration is protected by a workspace membership policy'
);
select ok(
  not exists (
    select required.key
    from (values
      ('general-services'),
      ('healthcare-practice'),
      ('wellness-studio'),
      ('legal-practice'),
      ('accounting-firm')
    ) as required(key)
    where not exists (
      select 1
      from public.sector_packs pack
      where pack.key = required.key
        and pack.version = 1
        and pack.is_active
    )
  ),
  'All five launch Sector Packs are seeded and active'
);
select ok(
  (select count(*) from public.sector_packs where key = 'general-services' and version = 1) = 1,
  'General Services fallback pack exists exactly once'
);
select ok(
  to_regprocedure('private.provision_default_sector_config()') is not null,
  'Default Sector Pack provisioning function exists'
);
select ok(
  exists (
    select 1
    from pg_trigger
    where tgrelid = 'public.workspaces'::regclass
      and tgname = 'workspaces_provision_default_sector_config'
      and not tgisinternal
  ),
  'New workspaces receive a default Sector Pack configuration'
);

select * from finish();
rollback;
