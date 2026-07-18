begin;

create or replace function private.enforce_invitation_expiry()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  sent_at timestamptz;
  maximum_expiry timestamptz;
begin
  if new.status <> 'invited' then
    return new;
  end if;

  sent_at := coalesce(new.invitation_last_sent_at, now());
  maximum_expiry := sent_at + interval '1 day';

  new.invitation_last_sent_at := sent_at;
  if new.invitation_expires_at is null or new.invitation_expires_at > maximum_expiry then
    new.invitation_expires_at := maximum_expiry;
  end if;

  if new.invitation_expires_at <= sent_at then
    raise exception 'Invitation expiry must be after the invitation was sent';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_invitation_expiry() from public;

drop trigger if exists workspace_memberships_enforce_invitation_expiry
  on public.workspace_memberships;
create trigger workspace_memberships_enforce_invitation_expiry
before insert or update of status, invitation_last_sent_at, invitation_expires_at
on public.workspace_memberships
for each row execute function private.enforce_invitation_expiry();

comment on function private.enforce_invitation_expiry() is
  'Keeps BDB membership invitation records within the supported one-day Supabase authentication-link lifetime.';

commit;
