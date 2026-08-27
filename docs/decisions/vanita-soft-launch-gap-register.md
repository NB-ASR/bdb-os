# Vanita soft-launch gap register

Baseline: `main` at `6b49fe6a826ba7a3aa874ce7f207d6ad1fa10162`,
audited through 27 August 2026.

## BLOCKER

- No reproduced software, tenant-isolation, data-integrity or recovery blocker
  remains in the accepted release candidate.

## HIGH

- Resolved: Calendar PR #59 stopped at Pass 1. The final candidate adds actor/workspace
  cache isolation, safe ambiguous retry, bounded reads, configured rooms,
  Service eligibility and UK DST-gap rejection.
- Resolved: Supplier Payables used the caller client for a service-role-only summary RPC.
- Resolved: malformed business-document render URLs escaped the structured command
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
