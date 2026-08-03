begin;

select plan(58);

select has_table('public', 'workspace_templates', 'Workspace templates exist');
select has_table('public', 'workspace_template_features', 'Template feature matrices exist');
select has_table('public', 'workspace_template_permissions', 'Template permission matrices exist');
select has_table('public', 'workspace_access_profile_permissions', 'Workspace access-profile snapshots exist');

select has_column('public', 'workspaces', 'workspace_template_id', 'Workspaces retain template identity');
select has_column('public', 'workspaces', 'workspace_template_version', 'Workspaces retain template version');

select ok((select relrowsecurity from pg_class where oid='public.workspace_templates'::regclass), 'Workspace templates use RLS');
select ok((select relrowsecurity from pg_class where oid='public.workspace_template_features'::regclass), 'Template features use RLS');
select ok((select relrowsecurity from pg_class where oid='public.workspace_template_permissions'::regclass), 'Template permissions use RLS');
select ok((select relrowsecurity from pg_class where oid='public.workspace_access_profile_permissions'::regclass), 'Workspace access presets use RLS');

select ok(
  not exists (
    select 1 from pg_policies
    where schemaname='public'
      and tablename in (
        'workspace_templates',
        'workspace_template_features',
        'workspace_template_permissions',
        'workspace_access_profile_permissions'
      )
  ),
  'Template configuration exposes no browser RLS policies'
);
select ok(not has_table_privilege('authenticated','public.workspace_templates','SELECT'), 'Authenticated users cannot read platform templates directly');
select ok(not has_table_privilege('authenticated','public.workspace_templates','INSERT'), 'Authenticated users cannot insert platform templates directly');
select ok(not has_table_privilege('authenticated','public.workspace_template_features','SELECT'), 'Authenticated users cannot read template features directly');
select ok(not has_table_privilege('authenticated','public.workspace_template_permissions','SELECT'), 'Authenticated users cannot read template permissions directly');
select ok(not has_table_privilege('authenticated','public.workspace_access_profile_permissions','SELECT'), 'Authenticated users cannot read workspace access presets directly');
select ok(not has_table_privilege('anon','public.workspace_templates','SELECT'), 'Anonymous users cannot read workspace templates');

select has_function(
  'public',
  'save_workspace_template',
  array['uuid','uuid','text','text','text','uuid','boolean','boolean','jsonb','jsonb','jsonb','jsonb'],
  'Trusted template save command exists'
);
select has_function(
  'public',
  'apply_workspace_template',
  array['uuid','uuid','uuid','text','text'],
  'Trusted template application command exists'
);
select ok(has_function_privilege('service_role','public.save_workspace_template(uuid,uuid,text,text,text,uuid,boolean,boolean,jsonb,jsonb,jsonb,jsonb)','EXECUTE'), 'Service role can save templates');
select ok(has_function_privilege('service_role','public.apply_workspace_template(uuid,uuid,uuid,text,text)','EXECUTE'), 'Service role can apply templates');
select ok(not has_function_privilege('authenticated','public.save_workspace_template(uuid,uuid,text,text,text,uuid,boolean,boolean,jsonb,jsonb,jsonb,jsonb)','EXECUTE'), 'Authenticated clients cannot save templates directly');
select ok(not has_function_privilege('authenticated','public.apply_workspace_template(uuid,uuid,uuid,text,text)','EXECUTE'), 'Authenticated clients cannot apply templates directly');

select ok(exists(select 1 from public.workspace_templates where is_active), 'At least one active workspace template is seeded');
select is((select count(*)::integer from public.workspace_templates where is_active and is_default), 1, 'Exactly one active default template exists');
select ok(
  not exists (
    select 1
    from public.workspace_templates template
    left join public.plans plan on plan.id=template.plan_id and plan.is_active
    where template.is_active and plan.id is null
  ),
  'Every active template references an active plan'
);
select ok(
  not exists (
    select 1
    from public.workspace_templates template
    where template.is_active
      and (
        select count(*) from public.workspace_template_features feature
        where feature.template_id=template.id
      ) <> (
        select count(*) from public.features feature where feature.is_active
      )
  ),
  'Every active template has a complete feature matrix'
);
select ok(
  not exists (
    select 1
    from public.workspace_templates template
    where template.is_active
      and (
        select count(*) from public.workspace_template_permissions permission
        where permission.template_id=template.id
      ) <> 3 * (
        select count(*) from public.features feature where feature.is_active
      )
  ),
  'Every active template has complete Manager, Employee and Custom matrices'
);
select ok(
  not exists (
    select 1 from public.workspace_template_permissions
    where access_profile not in ('manager','employee','custom')
  ),
  'Template permissions contain only supported access profiles'
);
select ok(
  exists(select 1 from pg_indexes where schemaname='public' and indexname='workspace_templates_plan_idx')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='workspace_template_features_feature_idx')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='workspace_template_permissions_feature_idx')
  and exists(select 1 from pg_indexes where schemaname='public' and indexname='workspace_access_profile_permissions_feature_idx'),
  'Template foreign keys have covering indexes'
);

select ok(position('workspace_access_profile_permissions' in lower(pg_get_functiondef('private.actor_has_workspace_permission(uuid,uuid,text,text)'::regprocedure))) > 0, 'Permission resolution uses workspace access presets');
select ok(
  position('explicit_permission' in lower(pg_get_functiondef('private.actor_has_workspace_permission(uuid,uuid,text,text)'::regprocedure)))
  < position('profile_permission' in lower(pg_get_functiondef('private.actor_has_workspace_permission(uuid,uuid,text,text)'::regprocedure))),
  'Explicit member permissions take priority over workspace presets'
);
select ok(position('template.version + 1' in lower(pg_get_functiondef('public.save_workspace_template(uuid,uuid,text,text,text,uuid,boolean,boolean,jsonb,jsonb,jsonb,jsonb)'::regprocedure))) > 0, 'Template updates increment the version');
select ok(position('platform_admins' in lower(pg_get_functiondef('public.save_workspace_template(uuid,uuid,text,text,text,uuid,boolean,boolean,jsonb,jsonb,jsonb,jsonb)'::regprocedure))) > 0, 'Template saves verify the Founder actor');
select ok(position('incomplete_template_feature_matrix' in lower(pg_get_functiondef('public.save_workspace_template(uuid,uuid,text,text,text,uuid,boolean,boolean,jsonb,jsonb,jsonb,jsonb)'::regprocedure))) > 0, 'Template saves require complete module matrices');
select ok(position('incomplete_template_permission_matrix' in lower(pg_get_functiondef('public.save_workspace_template(uuid,uuid,text,text,text,uuid,boolean,boolean,jsonb,jsonb,jsonb,jsonb)'::regprocedure))) > 0, 'Template saves require complete permission matrices');
select ok(position('active_template_required' in lower(pg_get_functiondef('public.apply_workspace_template(uuid,uuid,uuid,text,text)'::regprocedure))) > 0, 'Provisioning requires an active template');
select ok(position('workspace_already_configured' in lower(pg_get_functiondef('public.apply_workspace_template(uuid,uuid,uuid,text,text)'::regprocedure))) > 0, 'Template application rejects configured workspaces');
select ok(position('workspace_template_version = selected_template.version' in lower(pg_get_functiondef('public.apply_workspace_template(uuid,uuid,uuid,text,text)'::regprocedure))) > 0, 'Template application snapshots version provenance');
select ok(position('workspace_feature_overrides' in lower(pg_get_functiondef('public.apply_workspace_template(uuid,uuid,uuid,text,text)'::regprocedure))) > 0, 'Template application copies the module matrix');
select ok(position('workspace_access_profile_permissions' in lower(pg_get_functiondef('public.apply_workspace_template(uuid,uuid,uuid,text,text)'::regprocedure))) > 0, 'Template application copies access presets');
select ok(position('workspace.template_applied' in lower(pg_get_functiondef('public.apply_workspace_template(uuid,uuid,uuid,text,text)'::regprocedure))) > 0, 'Template application creates audit evidence');
select ok(
  not exists (
    select 1
    from public.workspaces workspace
    cross join (values ('manager'),('employee'),('custom')) profile(access_profile)
    cross join public.features feature
    where feature.is_active
      and not exists (
        select 1
        from public.workspace_access_profile_permissions permission
        where permission.workspace_id=workspace.id
          and permission.access_profile=profile.access_profile
          and permission.feature_key=feature.key
      )
  ),
  'Existing workspaces have legacy-compatible access-profile snapshots'
);

create temporary table template_test_context (
  actor_id uuid not null,
  workspace_id uuid not null,
  plan_id uuid not null,
  template_id uuid,
  original_version integer,
  applied_result jsonb
) on commit drop;

insert into template_test_context(actor_id, workspace_id, plan_id)
select gen_random_uuid(), gen_random_uuid(), plan.id
from public.plans plan
where plan.is_active
order by plan.sort_order
limit 1;

insert into auth.users (
  id,
  aud,
  role,
  email,
  raw_app_meta_data,
  raw_user_meta_data,
  is_sso_user,
  is_anonymous,
  created_at,
  updated_at
)
select actor_id, 'authenticated', 'authenticated', 'template-test-founder@example.invalid', '{}'::jsonb, '{}'::jsonb, false, false, now(), now()
from template_test_context;

insert into public.platform_admins(user_id, role, active, created_by)
select actor_id, 'founder', true, actor_id
from template_test_context;

update template_test_context context
set template_id = public.save_workspace_template(
  context.actor_id,
  null,
  'pgtap-workspace-template',
  'pgTAP workspace template',
  'Transactional template lifecycle test',
  context.plan_id,
  true,
  false,
  jsonb_build_object('currency','EUR','invoicePrefix','TST','vatRate',18,'timezone','Europe/Malta'),
  jsonb_build_object('preset','obsidian-gold','mode','dark','accentColor','#b08d3b','fontFamily','manrope','textScale',1,'density','comfortable','highContrast',false,'reducedMotion',false),
  (
    select jsonb_agg(jsonb_build_object(
      'featureKey', feature.key,
      'enabled', feature.key in ('overview','customers','team_members')
    ) order by feature.sort_order)
    from public.features feature
    where feature.is_active
  ),
  (
    select jsonb_agg(jsonb_build_object(
      'accessProfile', profile.access_profile,
      'featureKey', feature.key,
      'can_view', profile.access_profile in ('manager','employee'),
      'can_create', profile.access_profile in ('manager','employee'),
      'can_edit', profile.access_profile in ('manager','employee'),
      'can_delete', false,
      'can_approve', profile.access_profile='manager',
      'can_export', profile.access_profile='manager'
    ) order by profile.access_profile, feature.sort_order)
    from public.features feature
    cross join (values ('manager'),('employee'),('custom')) profile(access_profile)
    where feature.is_active
  )
);

update template_test_context context
set original_version = template.version
from public.workspace_templates template
where template.id=context.template_id;

insert into public.workspaces(id, slug, name, status)
select workspace_id, 'pgtap-template-' || left(workspace_id::text,8), 'pgTAP template workspace', 'trial'
from template_test_context;

update template_test_context context
set applied_result = public.apply_workspace_template(
  context.workspace_id,
  context.template_id,
  context.actor_id,
  'Template Test Owner',
  'owner@example.invalid'
);

select is((select version from public.workspace_templates where id=(select template_id from template_test_context)), 1, 'New template starts at version 1');
select is((select workspace_template_version from public.workspaces where id=(select workspace_id from template_test_context)), 1, 'Workspace records applied template version 1');
select is((select plan_id from public.workspaces where id=(select workspace_id from template_test_context)), (select plan_id from template_test_context), 'Template plan is copied to the workspace');
select is((select currency from public.workspace_settings where workspace_id=(select workspace_id from template_test_context)), 'EUR', 'Template currency is copied');
select is((select timezone from public.workspace_settings where workspace_id=(select workspace_id from template_test_context)), 'Europe/Malta', 'Template timezone is copied');
select is((select accent_color from public.workspace_themes where workspace_id=(select workspace_id from template_test_context)), '#b08d3b', 'Template appearance is copied');
select is(
  (select count(*)::integer from public.workspace_feature_overrides where workspace_id=(select workspace_id from template_test_context)),
  (select count(*)::integer from public.features where is_active),
  'Every active module receives an explicit workspace snapshot'
);
select is(
  (select count(*)::integer from public.workspace_access_profile_permissions where workspace_id=(select workspace_id from template_test_context)),
  3 * (select count(*)::integer from public.features where is_active),
  'Every access profile receives a complete workspace snapshot'
);
select ok(
  not (select can_delete from public.workspace_access_profile_permissions
    where workspace_id=(select workspace_id from template_test_context)
      and access_profile='manager'
      and feature_key='overview'),
  'Initial Manager delete permission is copied as false'
);

select public.save_workspace_template(
  context.actor_id,
  context.template_id,
  'pgtap-workspace-template',
  'pgTAP workspace template',
  'Version two changes the source Manager preset',
  context.plan_id,
  true,
  false,
  jsonb_build_object('currency','GBP','invoicePrefix','NEW','vatRate',20,'timezone','Europe/London'),
  jsonb_build_object('preset','obsidian-gold','mode','light','accentColor','#d3a84b','fontFamily','manrope','textScale',1.1,'density','compact','highContrast',false,'reducedMotion',false),
  (
    select jsonb_agg(jsonb_build_object(
      'featureKey', feature.key,
      'enabled', true
    ) order by feature.sort_order)
    from public.features feature
    where feature.is_active
  ),
  (
    select jsonb_agg(jsonb_build_object(
      'accessProfile', profile.access_profile,
      'featureKey', feature.key,
      'can_view', profile.access_profile in ('manager','employee'),
      'can_create', profile.access_profile in ('manager','employee'),
      'can_edit', profile.access_profile in ('manager','employee'),
      'can_delete', profile.access_profile='manager' and feature.key='overview',
      'can_approve', profile.access_profile='manager',
      'can_export', profile.access_profile='manager'
    ) order by profile.access_profile, feature.sort_order)
    from public.features feature
    cross join (values ('manager'),('employee'),('custom')) profile(access_profile)
    where feature.is_active
  )
)
from template_test_context context;

select is((select version from public.workspace_templates where id=(select template_id from template_test_context)), 2, 'Saving an existing template creates version 2');
select is((select workspace_template_version from public.workspaces where id=(select workspace_id from template_test_context)), 1, 'Existing workspace provenance remains on version 1');
select ok(
  not (select can_delete from public.workspace_access_profile_permissions
    where workspace_id=(select workspace_id from template_test_context)
      and access_profile='manager'
      and feature_key='overview'),
  'Later template permission edits do not mutate the workspace snapshot'
);
select is((select currency from public.workspace_settings where workspace_id=(select workspace_id from template_test_context)), 'EUR', 'Later template Settings edits do not mutate the workspace snapshot');
select is((select mode from public.workspace_themes where workspace_id=(select workspace_id from template_test_context)), 'dark', 'Later template appearance edits do not mutate the workspace snapshot');
select throws_ok(
  format(
    'select public.apply_workspace_template(%L::uuid,%L::uuid,%L::uuid,%L,%L)',
    (select workspace_id from template_test_context),
    (select template_id from template_test_context),
    (select actor_id from template_test_context),
    'Template Test Owner',
    'owner@example.invalid'
  ),
  'P0001',
  'WORKSPACE_ALREADY_CONFIGURED',
  'Template application cannot merge into an already configured workspace'
);

select * from finish();
rollback;
