# Business Document Branding Snapshots V1

## Decision

Issued Invoices, Credit Notes and Delivery Notes permanently preserve the logo state that existed when they were issued.

- A document issued before Custom Business Branding was enabled keeps no logo.
- A document issued while a logo version was active keeps that exact logo version.
- Replacing, disabling or removing current workspace branding does not rewrite historical documents.
- New documents use the branding state effective at their own issue time.
- Legacy drafts may preview current branding because they are not issued records.

## Reason

BDB OS separates historical documents from current business settings. An issued document records what happened at that point in time; current settings can evolve independently. Re-rendering an older Invoice with a newly uploaded logo would silently alter customer paperwork and weaken auditability.

## Implementation

Each issued document stores:

- `supplier_logo_path_snapshot`
- `branding_snapshot_at`

The issue transition snapshots the effective `custom_branding` state and current versioned logo path in the database. The document renderer uses the snapshot for every issued document and never falls back to today's workspace logo.

Branding uploads already use unique versioned storage paths. Founder Admin cleanup now retains a previous logo object while any issued Invoice, Credit Note or Delivery Note references that path. Unreferenced versions may still be removed.

The migration reconstructs existing issued-document branding from Founder Admin audit history. Custom Business Branding launched disabled-by-default and its logo changes/feature overrides are audited, allowing the current historical BDB documents to be restored correctly rather than blindly receiving today's logo.

## Alternatives considered

### Always render current workspace branding
Rejected. This is the behaviour being corrected because it rewrites historical paperwork.

### Save the logo bytes directly in every document row
Rejected for V1. It duplicates binary data in Postgres and increases storage/database complexity unnecessarily.

### Generate and permanently store a full PDF at issue time
Potential future hardening, but too broad for this V1 correction. The existing renderer can remain deterministic provided every mutable document input is snapshot appropriately.

## Risks

- Historical branding reconstruction depends on the audit trail for branding actions introduced with the branding feature. If a workspace had branding before those audit events existed, the safe fallback is no logo rather than guessing today's logo.
- Other currently live-rendered presentation fields should continue to be reviewed under the same immutable-document principle; this decision specifically closes the logo/branding gap.

## Future implication

The general rule is: **Documents freeze; business settings evolve.** Future document-facing settings should be snapshotted at issue rather than read live during re-rendering.
