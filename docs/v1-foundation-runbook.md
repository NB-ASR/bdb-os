# BDB OS V1 Foundation Runbook

This document covers the secure setup and acceptance testing required before PR #6 can be considered for merge. Do not place real secrets in GitHub.

## 1. Apply the database migrations

Apply the migrations in filename order to the connected Supabase project:

1. `20260715150000_v1_foundation.sql`
2. `20260715160000_v1_access_hardening.sql`
3. `20260715161000_team_access_core.sql`
4. `20260715162000_workspace_context_isolation.sql`

Confirm that all migrations complete successfully before testing the application preview.

## 2. Configure Vercel preview secrets

Set these server-side values in the Vercel Preview environment:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `NEXT_PUBLIC_APP_URL`
- `BDB_FOUNDER_EMAILS`
- `BDB_FOUNDER_NAMES`
- `FOUNDER_INITIAL_PASSWORD`
- `FOUNDER_BOOTSTRAP_SECRET`

The founder email and name lists must use the same order. The initial credential must never be committed and must be replaced by each Founder on first login.

## 3. Bootstrap the three Founder accounts

After the Preview deployment is using the migrated database and environment variables, call the protected endpoint once:

```bash
curl -X POST "$NEXT_PUBLIC_APP_URL/api/admin/bootstrap-founders" \
  -H "Authorization: Bearer $FOUNDER_BOOTSTRAP_SECRET"
```

The response should list every configured Founder with status `ready`.

## 4. Founder acceptance test

For each Founder account:

1. Sign in with the configured initial credential.
2. Confirm the application forces `/change-password`.
3. Set a unique private credential.
4. Confirm the application sends the Founder to `/mfa`.
5. Enrol a TOTP authenticator and verify it.
6. Confirm `/admin` opens.
7. Confirm a non-Founder account cannot open `/admin` even by typing the URL.

## 5. Client provisioning test

From Founder Admin:

1. Create a test business with a unique slug.
2. Enter the Business Owner's full name and email.
3. Choose a plan and explicitly select modules.
4. Confirm the business appears with status `trial`.
5. Confirm the owner membership is `invited` and shows a seven-day expiry.
6. Resend the owner invitation and confirm the expiry refreshes.
7. Suspend and reactivate the business.
8. Confirm each action appears in the audit trail.

## 6. Business Owner activation test

1. Open the owner invitation from the invited email account.
2. Confirm the invitation opens `/activate` rather than the workspace.
3. Enter the full name and a private credential.
4. Confirm the account cannot enter the business before activation completes.
5. Confirm successful activation opens only the invited business.
6. Confirm an expired invitation is rejected and can be resent.

## 7. Team Management test

As the Business Owner:

1. Open Team Management.
2. Invite an Employee, Manager and Custom user.
3. Confirm pending invitations show an expiry and resend control.
4. Activate each account from its own invited email.
5. Suspend and reactivate an employee.
6. Remove an employee and confirm their account remains but business access ends.
7. Attempt to suspend or remove the final active Owner and confirm it is blocked.
8. Confirm a Manager cannot promote anyone to Owner or alter an Owner.

## 8. Permission matrix test

For a Custom user, test each module and action:

- View
- Create
- Edit
- Delete
- Approve
- Export

Confirm denied actions fail at the Supabase/API layer even when a direct route or request is attempted. Do not accept menu visibility alone as proof of enforcement.

## 9. Business Group isolation test

1. Create two unrelated test businesses and use separate owner accounts.
2. Confirm neither business appears in the other's switcher.
3. Confirm direct database/API requests cannot query the unrelated workspace.
4. Create a Business Group and link two approved companies.
5. Give one user active membership in both linked companies.
6. Confirm only those linked companies appear in the switcher.
7. Confirm permissions remain separate in each company.
8. Remove one company from the group and confirm switching/direct access stops.
9. Invite an existing account from an unrelated company and confirm activation is blocked until the businesses are linked or a separate login email is used.

## 10. Required automated checks

Run before merge:

```bash
npm ci
npx tsc --noEmit
npm run lint
npm run build
```

Also review the Supabase security and performance advisors after applying the migrations.

## Merge rule

Keep PR #6 in draft until the Preview deployment, migrations, Founder bootstrap, invitation emails, permissions, and isolation tests above have passed. Do not merge directly into `main` without Founder approval.
