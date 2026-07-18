# Quality foundation security migration review

Migration: `20260718193000_quality_foundation_security.sql`

## Status

Prepared on `qa/security-reliability-foundation`. **Not applied to production.**

## Business problem

BDB OS must prevent a signed-in user from changing account-control fields such as suspension state or forced-password-change state. It also needs a trustworthy, append-only business history that browser clients cannot forge or delete.

## Changes

1. Removes all anonymous access to `profiles`.
2. Limits authenticated profile updates to `full_name`, `phone`, `avatar_path` and `active_workspace_id`.
3. Adds a defence-in-depth trigger protecting `id`, `is_active` and `must_change_password`.
4. Extends `activity_items` with entity, command and metadata context.
5. Makes business activity append-only from the browser while retaining tenant-scoped reads.
6. Adds indexes for workspace timeline and entity-history queries.

## Expected application impact

- Existing profile editing for name, phone, avatar and approved workspace switching continues.
- Founder Admin, invitation activation and trusted server routes continue through the Supabase service role.
- Any browser code that directly inserts `activity_items` will stop working. Current `main` does not persist activity through that table; future writes must use the server command layer.

## Risks

- An undiscovered client component may rely on broad profile updates.
- A future branch may currently insert activity directly from the browser.
- A malformed migration could remove a required grant.

## Pre-application checks

1. Rebase the branch onto the latest `main`.
2. Search all active branches for direct writes to `profiles.is_active`, `profiles.must_change_password` and `activity_items`.
3. Apply to a disposable Supabase branch or local database first.
4. Run `supabase/tests/quality_foundation_security.sql`.
5. Test profile editing, workspace switching, invitation activation, founder login/MFA and suspended-account denial.

## Rollback

Use only after identifying the failing workflow. This rollback restores the previous broad authenticated grants and activity insert policy; it intentionally does not remove the newly added nullable activity columns or indexes because they are backwards-compatible.

```sql
begin;

drop trigger if exists profiles_protect_security_fields on public.profiles;
drop function if exists private.enforce_profile_security_fields();

grant insert, update, delete, truncate, references, trigger
  on table public.profiles to authenticated;

grant insert, update, delete, truncate, references, trigger
  on table public.activity_items to authenticated;

create policy "Activity feature insert"
on public.activity_items
for insert
to authenticated
with check (
  actor_user_id = (select auth.uid())
  and private.can_write_workspace(workspace_id)
  and private.has_feature(workspace_id, 'activity')
);

commit;
```

Restoring broad grants is only an emergency rollback. The preferred correction is to grant the exact missing safe operation.
