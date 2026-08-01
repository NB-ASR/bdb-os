begin;

create or replace view public.customer_360_communication_summary
with (security_invoker = true)
as
select thread.workspace_id,
       thread.customer_id,
       count(distinct thread.id)::integer as thread_count,
       count(distinct thread.id) filter (where thread.status = 'open')::integer as open_thread_count,
       count(message.id) filter (where message.draft_state <> 'dismissed')::integer as message_count,
       count(message.id) filter (
         where message.direction = 'inbound'
           and message.unread = true
           and message.draft_state <> 'dismissed'
       )::integer as unread_message_count,
       count(message.id) filter (where message.draft_state = 'review')::integer as draft_review_count,
       max(greatest(thread.last_message_at, message.occurred_at)) as last_communication_at
from public.communication_threads thread
join public.messages message
  on message.workspace_id = thread.workspace_id
 and message.thread_id = thread.id
group by thread.workspace_id, thread.customer_id;

create or replace view public.customer_360_communication_activity
with (security_invoker = true)
as
select message.workspace_id,
       message.customer_id,
       'communication'::text as source_type,
       message.id as source_id,
       case
         when message.draft_state = 'review' then 'communication_draft_recorded'
         when message.direction = 'inbound' then 'communication_received'
         else 'communication_recorded'
       end as event_type,
       case
         when message.draft_state = 'review' then 'Communication draft recorded'
         when message.direction = 'inbound' then 'Communication received'
         else 'Outbound communication recorded'
       end as title,
       concat_ws(' · ', message.channel, message.subject, left(message.body, 240)) as detail,
       case
         when message.draft_state = 'review' then 'gold'
         when message.direction = 'inbound' then 'blue'
         else 'green'
       end as tone,
       message.occurred_at,
       ('/communications?threadId=' || message.thread_id::text || '&customerId=' || message.customer_id::text)::text as route,
       jsonb_build_object(
         'thread_id', message.thread_id,
         'message_id', message.id,
         'channel', message.channel,
         'direction', message.direction,
         'draft_state', message.draft_state,
         'unread', message.unread,
         'reply_to_message_id', message.reply_to_message_id
       ) as metadata
from public.messages message
where message.draft_state <> 'dismissed'

union all

select activity.workspace_id,
       (activity.metadata ->> 'customer_id')::uuid,
       'communication'::text,
       activity.id,
       coalesce(activity.metadata ->> 'event_type', 'communication_lifecycle'),
       activity.action,
       activity.detail,
       activity.tone,
       activity.occurred_at,
       ('/communications?threadId=' || activity.metadata ->> 'thread_id' || '&customerId=' || activity.metadata ->> 'customer_id')::text,
       activity.metadata
from public.activity_items activity
where activity.entity_type = 'communication_thread'
  and activity.metadata ->> 'source' = 'unified_communication_lifecycle'
  and activity.metadata ? 'customer_id'
  and activity.metadata ? 'thread_id';

revoke all on public.customer_360_communication_summary from public, anon, authenticated;
revoke all on public.customer_360_communication_activity from public, anon, authenticated;
grant select on public.customer_360_communication_summary to authenticated;
grant select on public.customer_360_communication_activity to authenticated;

commit;
