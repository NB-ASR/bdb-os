# Vanita soft-launch gap register

Baseline: `main` at `6b49fe6a826ba7a3aa874ce7f207d6ad1fa10162`,
audited 26 August 2026.

## BLOCKER

- A successful encrypted Production database backup and restore-list
  verification must be recorded before real client data is entered. A daily,
  seven-day-retention, public-key-encrypted workflow is now present; its first
  run requires the `SUPABASE_DB_URL` repository secret.

## HIGH

- Calendar PR #59 stopped at Pass 1. The final candidate adds actor/workspace
  cache isolation, safe ambiguous retry, bounded reads, configured rooms,
  Service eligibility and UK DST-gap rejection.
- Supplier Payables used the caller client for a service-role-only summary RPC.
- Malformed business-document render URLs escaped the structured command
  boundary.
- The real Vanita owner identity is not yet available; acceptance uses
  rollback-only QA identities until it is supplied. Invitation and real-owner
  acceptance are explicitly deferred until the email is available.

## MEDIUM

- Supabase Preview branching costs USD 0.01344/hour on the current Free
  organisation. Preview remains deliberately quarantined rather than using
  Production credentials until paid branching is approved.
- Supabase leaked-password protection is unavailable on the current plan.
  Privileged accounts require strong passwords and MFA.
- Supabase Storage objects need a separate encrypted export in addition to the
  database backup.
- The duplicate Vercel project remains Git-linked at the Founder's direction.
  `bdb-os` is the canonical project because it owns the live Production aliases;
  retirement of `bdb-os-7uou` is deferred until a later authenticated settings
  review.

## LOW

- Informational unused-index and unindexed-foreign-key advisor notices remain
  deferred unless a launch-path query plan proves a real scale issue.
- Meetings and Timesheets remain explicitly deferred from Calendar V1.
