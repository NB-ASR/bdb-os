begin;

select plan(30);

select has_column('public', 'workspace_memberships', 'invitation_delivery_status', 'Invitation delivery status is persisted');
select has_column('public', 'workspace_memberships', 'invitation_delivery_attempted_at', 'Invitation delivery attempt time is persisted');
select has_column('public', 'workspace_memberships', 'invitation_delivery_error_code', 'Invitation delivery failure code is persisted');
select has_function('public', 'founder_workspace_deletion_preview', array['uuid'], 'Workspace deletion preview exists');
select has_function('public', 'founder_delete_empty_workspace', array['uuid','text','uuid'], 'Guarded workspace delete exists');
select has_function('public', 'founder_unused_auth_user_preview', array['uuid'], 'Unused Auth account preview exists');

select ok(has_function_privilege('service_role','public.founder_workspace_deletion_preview(uuid)','EXECUTE'), 'Service role can review workspace deletion');
select ok(not has_function_privilege('authenticated','public.founder_workspace_deletion_preview(uuid)','EXECUTE'), 'Business sessions cannot review workspace deletion');
select ok(not has_function_privilege('anon','public.founder_workspace_deletion_preview(uuid)','EXECUTE'), 'Anonymous sessions cannot review workspace deletion');
select ok(has_function_privilege('service_role','public.founder_delete_empty_workspace(uuid,text,uuid)','EXECUTE'), 'Service role can request guarded workspace deletion');
select ok(not has_function_privilege('authenticated','public.founder_delete_empty_workspace(uuid,text,uuid)','EXECUTE'), 'Business sessions cannot permanently delete workspaces');
select ok(has_function_privilege('service_role','public.founder_unused_auth_user_preview(uuid)','EXECUTE'), 'Service role can review unused Auth accounts');
select ok(not has_function_privilege('authenticated','public.founder_unused_auth_user_preview(uuid)','EXECUTE'), 'Business sessions cannot inspect cross-platform Auth references');

select ok(
  position('invoices' in pg_get_functiondef('public.founder_workspace_deletion_preview(uuid)'::regprocedure)) > 0,
  'Deletion review explicitly counts protected Invoice history'
);
select ok(
  position('protected_financial_records' in pg_get_functiondef('public.founder_workspace_deletion_preview(uuid)'::regprocedure)) > 0,
  'Deletion review reports protected financial counts'
);
select ok(
  position('for update' in lower(pg_get_functiondef('public.founder_delete_empty_workspace(uuid,text,uuid)'::regprocedure))) > 0,
  'Permanent deletion locks and atomically rechecks the business'
);

insert into auth.users(id,email) values
  ('f0000000-0000-4000-8000-000000000001','founder-admin-v1@example.com'),
  ('f0000000-0000-4000-8000-000000000002','invited-v1@example.com'),
  ('f0000000-0000-4000-8000-000000000003','unused-v1@example.com');
insert into public.profiles(id,full_name) values
  ('f0000000-0000-4000-8000-000000000001','Founder Admin V1'),
  ('f0000000-0000-4000-8000-000000000002','Invited User V1'),
  ('f0000000-0000-4000-8000-000000000003','Unused User V1');
insert into public.platform_admins(user_id,role,active)
values ('f0000000-0000-4000-8000-000000000001','founder',true);

insert into public.workspaces(id,slug,name,status) values
  ('f1000000-0000-4000-8000-000000000001','founder-empty-v1','Founder Empty V1','trial'),
  ('f1000000-0000-4000-8000-000000000002','founder-history-v1','Founder History V1','trial'),
  ('f1000000-0000-4000-8000-000000000003','founder-invite-v1','Founder Invite V1','trial');

select lives_ok($$
  insert into public.workspace_memberships(
    workspace_id,user_id,role,access_profile,status,invited_by,
    invitation_delivery_status,invitation_last_sent_at,invitation_expires_at
  ) values (
    'f1000000-0000-4000-8000-000000000003','f0000000-0000-4000-8000-000000000002',
    'staff','employee','invited','f0000000-0000-4000-8000-000000000001',
    'pending',null,null
  )
$$, 'Pending invitations can be saved before email delivery');

select is(
  (select invitation_expires_at from public.workspace_memberships where workspace_id='f1000000-0000-4000-8000-000000000003'),
  null::timestamptz,
  'Pending delivery does not pretend an invitation link exists'
);

update public.workspace_memberships
set invitation_delivery_status='sent', invitation_delivery_attempted_at='2026-08-28 12:00:00+00'
where workspace_id='f1000000-0000-4000-8000-000000000003';

select is(
  (select invitation_expires_at from public.workspace_memberships where workspace_id='f1000000-0000-4000-8000-000000000003'),
  '2026-08-28 13:00:00+00'::timestamptz,
  'Sent invitation delivery receives the canonical one-hour expiry'
);

select ok(
  coalesce((public.founder_workspace_deletion_preview('f1000000-0000-4000-8000-000000000001')->>'can_delete')::boolean,false),
  'A genuinely empty test business is eligible for permanent deletion'
);

insert into public.customers(id,workspace_id,code,name,company)
values ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000002','HIST-1','History Customer','History Ltd');

select ok(
  not coalesce((public.founder_workspace_deletion_preview('f1000000-0000-4000-8000-000000000002')->>'can_delete')::boolean,true),
  'A business with operational history is not eligible for permanent deletion'
);
select is(
  public.founder_delete_empty_workspace(
    'f1000000-0000-4000-8000-000000000002','Founder History V1','f0000000-0000-4000-8000-000000000001'
  )->>'code',
  'DELETION_BLOCKED',
  'Guarded deletion refuses a business containing records'
);
select ok(exists(select 1 from public.workspaces where id='f1000000-0000-4000-8000-000000000002'), 'Blocked business remains intact');

select is(
  public.founder_delete_empty_workspace(
    'f1000000-0000-4000-8000-000000000001','Wrong Name','f0000000-0000-4000-8000-000000000001'
  )->>'code',
  'CONFIRMATION_MISMATCH',
  'Typed business name must match exactly'
);
select ok(
  coalesce((public.founder_delete_empty_workspace(
    'f1000000-0000-4000-8000-000000000001','Founder Empty V1','f0000000-0000-4000-8000-000000000001'
  )->>'ok')::boolean,false),
  'A confirmed empty test business can be permanently deleted'
);
select ok(not exists(select 1 from public.workspaces where id='f1000000-0000-4000-8000-000000000001'), 'Deleted empty business no longer exists');
select ok(
  exists(
    select 1 from public.audit_logs
    where action='workspace.permanently_deleted'
      and workspace_id is null
      and metadata->'previous'->>'name'='Founder Empty V1'
  ),
  'Permanent deletion retains an attributed audit record after the workspace is gone'
);

select ok(
  coalesce((public.founder_unused_auth_user_preview('f0000000-0000-4000-8000-000000000003')->>'can_delete')::boolean,false),
  'An unused non-admin Auth account without history is eligible for deletion'
);
select ok(
  not coalesce((public.founder_unused_auth_user_preview('f0000000-0000-4000-8000-000000000001')->>'can_delete')::boolean,true),
  'A platform admin Auth account cannot be deleted as unused'
);
select ok(
  not coalesce((public.founder_unused_auth_user_preview('f0000000-0000-4000-8000-000000000002')->>'can_delete')::boolean,true),
  'An Auth account with business access cannot be deleted as unused'
);

select * from finish();
rollback;
