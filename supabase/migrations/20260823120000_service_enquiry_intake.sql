-- Reconcile the live commercial-intake function with source control and expose
-- it only to the trusted server role used by the public discovery route.

create or replace function public.submit_sales_enquiry(
  p_name text,
  p_business_name text,
  p_email text,
  p_starting_plan text,
  p_sector text,
  p_challenge text,
  p_team_size text,
  p_preferred_term text,
  p_source text,
  p_source_path text,
  p_ip_hash text,
  p_user_agent text
)
returns uuid
language plpgsql
security invoker
set search_path = 'pg_catalog', 'public'
as $$
declare
  enquiry_id uuid;
  recent_count integer;
begin
  -- Serialise submissions for one privacy-preserving IP digest so parallel
  -- requests cannot race past the hourly limit.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_ip_hash, 0));

  select count(*)::integer
    into recent_count
    from public.sales_enquiries
   where ip_hash = p_ip_hash
     and submitted_at > clock_timestamp() - interval '1 hour';

  if recent_count >= 5 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  insert into public.sales_enquiries (
    name, business_name, email, starting_plan, sector, challenge, team_size,
    preferred_term, source, source_path, ip_hash, user_agent
  ) values (
    btrim(p_name), btrim(p_business_name), lower(btrim(p_email)), p_starting_plan,
    p_sector, btrim(p_challenge), p_team_size, p_preferred_term,
    coalesce(nullif(btrim(p_source), ''), 'marketing-site'),
    coalesce(nullif(btrim(p_source_path), ''), '/discovery'),
    p_ip_hash, nullif(left(btrim(p_user_agent), 300), '')
  )
  returning id into enquiry_id;

  return enquiry_id;
end;
$$;

revoke all on function public.submit_sales_enquiry(text,text,text,text,text,text,text,text,text,text,text,text)
  from public, anon, authenticated;
grant execute on function public.submit_sales_enquiry(text,text,text,text,text,text,text,text,text,text,text,text)
  to service_role;

comment on function public.submit_sales_enquiry(text,text,text,text,text,text,text,text,text,text,text,text) is
  'Trusted service enquiry intake with a serialised five-per-hour privacy-preserving IP limit.';
