-- Team administration is required for every BDB OS client because each Business
-- Owner must be able to invite and control their own employees regardless of plan.
insert into public.plan_features (plan_id, feature_key, enabled)
select plan.id, 'team_members', true
from public.plans plan
where plan.is_active
on conflict (plan_id, feature_key) do update set enabled = excluded.enabled;
