begin;

select plan(56);

select has_table('public', 'communication_threads', 'Communication threads exist');
select has_table('public', 'messages', 'Authoritative Communication messages exist');
select has_table('public', 'communication_command_receipts', 'Communication command receipts exist');
select has_view('public', 'unified_communication_index', 'Unified inbox index exists');
select has_view('public', 'customer_360_communication_summary', 'Customer 360 Communication summary exists');
select has_view('public', 'customer_360_communication_activity', 'Customer 360 Communication activity exists');

select has_function(
  'public', 'record_communication_message',
  array['uuid','uuid','uuid','uuid','text','text','text','text','uuid','text','text','uuid','uuid','timestamp with time zone'],
  'Trusted Communication recording command exists'
);
select has_function(
  'public', 'mark_communication_message_read',
  array['uuid','uuid','uuid','text','uuid','uuid','timestamp with time zone'],
  'Trusted Communication read command exists'
);
select has_function(
  'public', 'dismiss_communication_draft',
  array['uuid','uuid','uuid','text','text','uuid','uuid','timestamp with time zone'],
  'Trusted Communication draft dismissal exists'
);
select has_function(
  'public', 'close_communication_thread',
  array['uuid','uuid','text','text','uuid','uuid','timestamp with time zone'],
  'Trusted Communication thread closure exists'
);

select ok((select relrowsecurity from pg_class where oid='public.communication_threads'::regclass), 'Communication threads use RLS');
select ok((select relrowsecurity from pg_class where oid='public.messages'::regclass), 'Communication messages use RLS');
select ok((select relrowsecurity from pg_class where oid='public.communication_command_receipts'::regclass), 'Communication receipts use RLS');

select ok(has_table_privilege('authenticated','public.communication_threads','SELECT'), 'Authenticated users retain RLS-scoped thread reads');
select ok(has_table_privilege('authenticated','public.messages','SELECT'), 'Authenticated users retain RLS-scoped message reads');
select ok(not has_table_privilege('authenticated','public.communication_threads','INSERT'), 'Browser clients cannot insert Communication threads');
select ok(not has_table_privilege('authenticated','public.communication_threads','UPDATE'), 'Browser clients cannot update Communication threads');
select ok(not has_table_privilege('authenticated','public.communication_threads','DELETE'), 'Browser clients cannot delete Communication threads');
select ok(not has_table_privilege('authenticated','public.messages','INSERT'), 'Browser clients cannot insert Communication messages');
select ok(not has_table_privilege('authenticated','public.messages','UPDATE'), 'Browser clients cannot update Communication messages');
select ok(not has_table_privilege('authenticated','public.messages','DELETE'), 'Browser clients cannot delete Communication messages');
select ok(not has_table_privilege('anon','public.messages','SELECT'), 'Anonymous users cannot read Communication messages');
select ok(not has_table_privilege('authenticated','public.communication_command_receipts','SELECT'), 'Browser clients cannot read Communication receipts');
select ok(not has_table_privilege('authenticated','public.communication_command_receipts','INSERT'), 'Browser clients cannot insert Communication receipts');

select ok(has_function_privilege('service_role','public.record_communication_message(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,uuid,uuid,timestamp with time zone)','EXECUTE'), 'Service role can record Communication messages');
select ok(has_function_privilege('service_role','public.mark_communication_message_read(uuid,uuid,uuid,text,uuid,uuid,timestamp with time zone)','EXECUTE'), 'Service role can mark Communication read');
select ok(has_function_privilege('service_role','public.dismiss_communication_draft(uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone)','EXECUTE'), 'Service role can dismiss Communication drafts');
select ok(has_function_privilege('service_role','public.close_communication_thread(uuid,uuid,text,text,uuid,uuid,timestamp with time zone)','EXECUTE'), 'Service role can close Communication threads');
select ok(not has_function_privilege('authenticated','public.record_communication_message(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,uuid,uuid,timestamp with time zone)','EXECUTE'), 'Authenticated clients cannot record Communication directly');
select ok(not has_function_privilege('authenticated','public.mark_communication_message_read(uuid,uuid,uuid,text,uuid,uuid,timestamp with time zone)','EXECUTE'), 'Authenticated clients cannot change Communication read state directly');
select ok(not has_function_privilege('authenticated','public.dismiss_communication_draft(uuid,uuid,uuid,text,text,uuid,uuid,timestamp with time zone)','EXECUTE'), 'Authenticated clients cannot dismiss drafts directly');
select ok(not has_function_privilege('authenticated','public.close_communication_thread(uuid,uuid,text,text,uuid,uuid,timestamp with time zone)','EXECUTE'), 'Authenticated clients cannot close threads directly');

select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.unified_communication_index'::regclass), false), 'Unified inbox preserves invoker RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.customer_360_communication_summary'::regclass), false), 'Customer Communication summary preserves invoker RLS');
select ok(coalesce((select reloptions @> array['security_invoker=true'] from pg_class where oid='public.customer_360_communication_activity'::regclass), false), 'Customer Communication activity preserves invoker RLS');

select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='communication_threads_workspace_activity_idx'), 'Thread workspace activity index exists');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='communication_threads_customer_activity_idx'), 'Thread Customer activity index exists');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='messages_thread_activity_idx'), 'Thread message activity index exists');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='messages_unread_inbound_idx'), 'Unread inbound message index exists');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='communication_command_receipts_thread_idx'), 'Communication receipt thread index exists');
select ok(exists(select 1 from pg_indexes where schemaname='public' and indexname='communication_command_receipts_message_idx'), 'Communication receipt message index exists');

select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='messages' and cmd='INSERT'), 'No browser Message insert policy remains');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='messages' and cmd='UPDATE'), 'No browser Message update policy remains');
select ok(not exists(select 1 from pg_policies where schemaname='public' and tablename='messages' and cmd='DELETE'), 'No browser Message delete policy remains');

select ok(position('message.direction' in lower(pg_get_viewdef('public.unified_communication_index'::regclass, true))) > 0, 'Unified inbox preserves message direction');
select ok(position('draft_review_count' in lower(pg_get_viewdef('public.unified_communication_index'::regclass, true))) > 0, 'Unified inbox exposes human draft review count');
select ok(position('unified_communication_lifecycle' in lower(pg_get_viewdef('public.customer_360_communication_activity'::regclass, true))) > 0, 'Customer 360 includes Communication lifecycle events');
select ok(position('communication_command_receipts' in lower(pg_get_functiondef('public.record_communication_message(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,uuid,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Message recording stores idempotency receipts');
select ok(position('closed communication threads cannot receive messages' in lower(pg_get_functiondef('public.record_communication_message(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,uuid,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Closed threads reject new messages');
select ok(position('communication_target_exists' in lower(pg_get_functiondef('public.record_communication_message(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,uuid,uuid,timestamp with time zone)'::regprocedure))) > 0, 'Message recording validates the exact Customer');
select ok(
  position('insert into public.customers' in lower(pg_get_functiondef('public.record_communication_message(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,uuid,uuid,timestamp with time zone)'::regprocedure))) = 0
  and position('update public.customers' in lower(pg_get_functiondef('public.record_communication_message(uuid,uuid,uuid,uuid,text,text,text,text,uuid,text,text,uuid,uuid,timestamp with time zone)'::regprocedure))) = 0,
  'Communication commands do not mutate Customers'
);
select ok(exists(
  select 1 from pg_constraint
  where conrelid='public.communication_command_receipts'::regclass
    and contype='p'
    and pg_get_constraintdef(oid)='PRIMARY KEY (workspace_id, idempotency_key)'
), 'Communication commands are idempotent per workspace');

select ok((select is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='messages' and column_name='thread_id'), 'Message thread identity is required');
select ok((select is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='messages' and column_name='direction'), 'Message direction is required');
select ok((select is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='messages' and column_name='body'), 'Message body is required');
select ok((select is_nullable='NO' from information_schema.columns where table_schema='public' and table_name='messages' and column_name='draft_state'), 'Message draft state is required');

select * from finish();
rollback;
