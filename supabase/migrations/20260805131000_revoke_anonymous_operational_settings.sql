begin;

revoke all on public.workspace_operational_settings from anon;
grant select on public.workspace_operational_settings to authenticated;
grant all on public.workspace_operational_settings to service_role;

commit;
