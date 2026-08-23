-- Reconcile the live commercial-intake function with source control and expose
-- it only to the trusted server role used by the public discovery route.

-- The original commercial-intake migration was recorded as a Production
-- history marker after an emergency rollout. Recreate its full table contract
-- here so a clean database replay is identical to Production.
create table if not exists public.sales_enquiries (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 120),
  business_name text not null check (char_length(business_name) between 2 and 160),
  email text not null check (char_length(email) between 5 and 254),
  starting_plan text not null check (starting_plan in ('not-sure', 'starter', 'growth', 'solo-operator', 'pro')),
  sector text not null check (sector in ('general', 'healthcare', 'wellness', 'legal', 'accounting', 'other')),
  challenge text not null check (char_length(challenge) between 20 and 4000),
  team_size text not null check (team_size in ('solo', '2-5', '6-15', '16-50', '50-plus')),
  preferred_term text not null check (preferred_term in ('3-months', '6-months', 'open')),
  status text not null default 'new' check (status in ('new', 'contacted', 'qualified', 'won', 'lost', 'spam')),
  source text not null default 'marketing-site' check (char_length(source) between 2 and 80),
  source_path text not null default '/discovery' check (char_length(source_path) between 1 and 300),
  ip_hash text not null check (char_length(ip_hash) = 64),
  user_agent text check (user_agent is null or char_length(user_agent) <= 300),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_enquiries_status_submitted_idx
  on public.sales_enquiries (status, submitted_at desc);
create index if not exists sales_enquiries_ip_submitted_idx
  on public.sales_enquiries (ip_hash, submitted_at desc);

alter table public.sales_enquiries enable row level security;
drop policy if exists "Sales enquiries are service managed" on public.sales_enquiries;
create policy "Sales enquiries are service managed"
  on public.sales_enquiries
  as restrictive
  for all
  to anon, authenticated
  using (false)
  with check (false);

revoke all on table public.sales_enquiries from public, anon, authenticated;
grant all on table public.sales_enquiries to service_role;

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
