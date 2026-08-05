create or replace function public.get_my_support_session()
returns table (
  session_id uuid,
  workspace_id uuid,
  workspace_name text,
  workspace_slug text,
  reason text,
  access_mode text,
  started_at timestamptz,
  expires_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select support_session.id,
         workspace.id,
         workspace.name,
         workspace.slug::text,
         support_session.reason,
         support_session.access_mode,
         support_session.started_at,
         support_session.expires_at
  from public.platform_support_sessions support_session
  join public.workspaces workspace
    on workspace.id = support_session.workspace_id
   and workspace.status in ('trial', 'active')
  where support_session.admin_user_id = (select auth.uid())
    and support_session.ended_at is null
    and support_session.expires_at > now()
  order by support_session.started_at desc
  limit 1;
$$;

revoke all on function public.get_my_support_session() from public, anon;
grant execute on function public.get_my_support_session() to authenticated;
