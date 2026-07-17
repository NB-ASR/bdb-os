alter table public.workspace_memberships
  add constraint workspace_memberships_profile_fkey
  foreign key (user_id)
  references public.profiles(id)
  on delete cascade;
