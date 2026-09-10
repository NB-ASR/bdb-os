begin;

select plan(20);

select has_table('public','founder_development_workspaces','Development workspace allowlist exists');
select has_table('public','founder_development_snapshots','Private reset snapshots exist');
select has_table('public','founder_development_reset_receipts','Idempotent reset receipts exist');
select has_function('public','founder_set_development_workspace',array['uuid','uuid','boolean','text','text','timestamp with time zone'],'Development designation command exists');
select has_function('public','founder_development_reset_preview',array['uuid','uuid','text'],'Dependency preview exists');
select has_function('public','founder_reset_development_workspace',array['uuid','uuid','text','text','text','text','timestamp with time zone'],'Canonical reset command exists');
select ok(has_function_privilege('service_role','public.founder_reset_development_workspace(uuid,uuid,text,text,text,text,timestamp with time zone)','EXECUTE'),'Service role can invoke reset command');
select ok(not has_function_privilege('authenticated','public.founder_reset_development_workspace(uuid,uuid,text,text,text,text,timestamp with time zone)','EXECUTE'),'Business sessions cannot invoke reset command');
select ok(not has_table_privilege('authenticated','public.founder_development_snapshots','SELECT'),'Business sessions cannot read recovery snapshots');

insert into auth.users(id,email) values
  ('d0000000-0000-4000-8000-000000000001','development-founder@example.com'),
  ('d0000000-0000-4000-8000-000000000002','development-support@example.com');
insert into public.profiles(id,full_name) values
  ('d0000000-0000-4000-8000-000000000001','Development Founder'),
  ('d0000000-0000-4000-8000-000000000002','Development Support')
on conflict(id) do update set full_name=excluded.full_name;
insert into public.platform_admins(user_id,role,active) values
  ('d0000000-0000-4000-8000-000000000001','founder',true),
  ('d0000000-0000-4000-8000-000000000002','support',true);
insert into public.workspaces(id,slug,name,status) values
  ('d1000000-0000-4000-8000-000000000001','mock-development-tools','Mock Development Tools','trial');

select throws_ok(
  $$select public.founder_set_development_workspace('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',true,'Mock Development Tools','Acceptance test workspace',now())$$,
  'Active Founder access required',
  'Support administrators cannot enable destructive tools'
);

select lives_ok(
  $$select public.founder_set_development_workspace('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',true,'Mock Development Tools','Acceptance test workspace',now())$$,
  'An active Founder can explicitly designate a mock workspace'
);
select ok(exists(select 1 from public.founder_development_workspaces where target_workspace_id='d1000000-0000-4000-8000-000000000001'),'Development designation is persisted');

insert into public.customers(id,workspace_id,code,name,email) values
  ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','DEV-1','Sanitised Test Customer','test-customer@example.invalid');

select is(
  (public.founder_development_reset_preview('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','customers')->>'can_reset')::boolean,
  true,
  'An unreferenced Customer scope is eligible for reset'
);
select is(
  (public.founder_development_reset_preview('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','customers')->>'affected_total')::bigint,
  1::bigint,
  'Preview counts affected Customer records'
);

select lives_ok(
  $$select public.founder_reset_development_workspace('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','customers','Mock Development Tools','development-reset-1',repeat('a',64),'2026-09-10 12:00:00+00')$$,
  'Founder reset creates a snapshot and clears the eligible scope'
);
select is((select count(*) from public.customers where workspace_id='d1000000-0000-4000-8000-000000000001'),0::bigint,'Customer records were cleared');
select is((select count(*) from public.founder_development_snapshots where target_workspace_id='d1000000-0000-4000-8000-000000000001'),1::bigint,'A recovery snapshot was retained before deletion');
select ok(exists(select 1 from public.audit_logs where workspace_id='d1000000-0000-4000-8000-000000000001' and action='founder.development_workspace.reset'),'The reset remains in the non-resettable audit log');

select lives_ok(
  $$select public.founder_reset_development_workspace('d1000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001','customers','Mock Development Tools','development-reset-1',repeat('a',64),'2026-09-10 12:05:00+00')$$,
  'An identical reset retry returns its durable receipt'
);
select is((select count(*) from public.founder_development_snapshots where target_workspace_id='d1000000-0000-4000-8000-000000000001'),1::bigint,'Idempotent retry does not create another snapshot');

select * from finish();
rollback;
