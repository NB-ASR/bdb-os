# Quality foundation migration review

Migrations:

- `20260718193000_quality_foundation_security.sql`
- `20260718193500_invitation_expiry_guard.sql`

## Status

Prepared on `qa/security-reliability-foundation`. **Not applied to production.**

## Business problem

BDB OS must prevent a signed-in user from changing account-control fields such as suspension state or forced-password-change state. Suspension must also be enforced inside database authorization, because an already-issued Auth session may remain valid after the profile is disabled.

The application also needs trustworthy append-only business history and an invitation record that never promises access beyond the Supabase authentication link.

## Security migration changes

1. Adds `private.is_active_profile()` as a fail-closed account-state helper.
2. Requires an active profile for Founder authorization, current-workspace resolution and workspace-role checks.
3. Removes anonymous access to `profiles`.
4. Limits authenticated profile updates to `full_name`, `phone`, `avatar_path` and `active_workspace_id`.
5. Adds a defence-in-depth trigger protecting `id`, `is_active` and `must_change_password`; browser Founder sessions do not bypass it.
6. Extends `activity_items` with entity, command and metadata context.
7. Makes business activity append-only from the browser while retaining tenant-scoped reads.
8. Adds indexes for workspace timeline and entity-history queries.

## Invitation migration changes

1. Adds a trigger that requires pending invitation records to have a send time and expiry.
2. Caps membership invitation expiry at one hour, matching the BDB OS Supabase Email OTP configuration.
3. Clamps existing pending records to the one-hour limit.

The production schema currently contains one pending invitation whose recorded expiry exceeds one hour. Applying the migration later will make that old invitation expired; it must be resent after deployment.

## Expected application impact

- Existing profile editing for name, phone, avatar and approved workspace switching continues.
- Suspended profiles lose database access even when an older Auth session still exists.
- Founder Admin, invitation activation and trusted server routes continue through the service role.
- Browser code cannot insert, alter or delete permanent business activity.
- Current `main` reads `activity_items` but does not write it directly, so the activity change does not remove an existing production save path.
- New and resent invitations use a one-hour membership window.

## Risks

- An undiscovered branch may rely on broad direct profile updates.
- A future branch may insert `activity_items` from the browser rather than through the server command layer.
- Existing pending invitation links must be resent after migration.
- Replacing shared database authorization helpers requires authenticated tests for active and suspended users before merge.
- Static validation cannot prove PostgreSQL execution; a local or disposable database remains the strongest pre-production proof.

## Pre-application checks

1. Rebase the branch onto the latest `main`.
2. Search all active branches for direct writes to protected profile fields and `activity_items`.
3. Apply both migrations to a disposable local database or a separately approved hosted branch.
4. Run `supabase/tests/quality_foundation_security.sql`.
5. Test safe profile editing and approved workspace switching.
6. Test a suspended user with an already-issued session and confirm database reads and writes are denied.
7. Test Founder login and MFA and confirm protected profile fields still require a trusted server operation.
8. Test invitation activation, expiry and resend using the one-hour setting.

## Targeted rollback policy

Do not restore the previous broad table grants. Broad rollback would reopen the security defect and allow browser clients to forge activity or update protected profile fields.

Use the smallest correction for the failing workflow:

### Safe profile field is missing

Add only the specific reviewed safe column to the authenticated profile-update grant. Never grant browser update access to `is_active`, `must_change_password`, identity fields or timestamps.

### Profile trigger causes a false positive

Correct the trigger condition in a forward migration. Do not allow a browser Founder session to bypass protected columns. Trusted server operations remain the only writer for account-control fields.

### Business activity writer is not ready

Keep activity append-only. Correct the trusted server writer or temporarily stop producing that activity event. Do not restore browser edit or deletion access.

### Active-profile helper blocks a legitimate user

Correct the affected profile or authorization helper after confirming the account should be active. Do not remove the active-profile requirement globally merely to restore one user.

### Invitation expiry causes onboarding failure

Resend the invitation and verify Supabase Email OTP Expiration is exactly 3600 seconds. Do not extend the database record beyond the authentication token.

## Data rollback

The new activity columns and indexes are nullable and backwards-compatible, so they do not need removal during an application rollback. The invitation clamp is intentionally not reversible because the older secure link may already be invalid at Supabase; recovery is a resend, not extending the stale record.
