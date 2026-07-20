# BDB OS V1 Launch Readiness Audit

**Branch:** `qa/launch-readiness-hardening-v1`  
**Base:** `main` after PR #9  
**Status:** Draft release candidate. Not approved for production merge.  
**Owners:** Giovanni, Matthew and Niki  

## Decision

BDB OS is not approved for a paid-customer launch yet.

The customer experience and core application structure are strong enough to continue toward launch, but the previous `main` branch still contained several unacceptable production behaviours:

- database failures could appear as successful saves;
- query failures could appear as empty workspaces;
- seeded demonstration records could appear while a real workspace was loading;
- offline status implied business-data persistence that did not exist;
- financial and operational screens displayed fixed or inferred claims that were not backed by verified records;
- Vanita Stock used last-write-wins cloud persistence and could silently lose rapid or concurrent edits.

This branch combines Giovanni's Quality Foundation with the current BDB design system and Matthew's Vanita Stock work, then addresses the highest-risk product defects without changing production data.

## Business problem

Paying businesses must be able to trust that:

1. a save confirmation means the database accepted the change;
2. an empty list means there are no records, not that a query failed;
3. one customer can never see another customer's records;
4. offline behaviour is described accurately;
5. financial figures come from verified data;
6. two staff members cannot silently overwrite stock changes;
7. visible capabilities match what the software actually performs.

## Department ownership

- **Giovanni:** launch scope, commercial truth, customer experience, acceptance decision.
- **Matthew:** invoice numbering, financial atomicity, bank/reconciliation commands, Vanita cloud deployment and integrations.
- **Niki:** architecture, data integrity, route security, reliability, build quality and release gates.

## Completed integration

Giovanni's `qa/security-reliability-foundation` branch was merged into this branch as a real two-parent Git merge.

The integration preserved:

- the current BDB OS design system;
- Vanita Stock;
- canonical production migration history;
- security and authentication hardening;
- CI, unit, browser and database tests;
- server command and activity contracts;
- Vanita output-file tracing and camera support.

The only manual merge conflict was `next.config.ts`. It was resolved by keeping the security policy while allowing same-origin camera access, required Google font origins and the two pinned Vanita CDN scripts.

## Fixed on this branch

### Security and access

- Protected routes fail closed when Supabase configuration is missing.
- Authentication, profile, admin, membership and feature-query failures no longer fall through into partially rendered workspaces.
- Suspended profiles and workspaces lose application access.
- Founder access remains MFA and database controlled.
- Notification clicks are restricted to same-origin BDB OS routes.
- Security headers, canonical migrations and database security tests from the Quality Foundation are preserved.

### Cloud loading and persistence

- Real cloud workspaces no longer render seeded demonstration records during initial load.
- A configured cloud workspace never falls back silently to browser demo data.
- Table query errors are distinguished from valid empty results.
- Insert, update and upsert failures throw explicit errors.
- Updates confirm that a database row actually changed.
- The interface updates only after a confirmed cloud write.
- The shared shell shows `Saving`, `Changes saved`, `Save failed`, `Connected`, `Local preview` or `Offline · view only` accurately.
- Failed writes display a visible, dismissible error banner.
- Document records are shown only after both storage and metadata succeed.
- Failed document metadata writes attempt to remove the orphaned stored file.

### Offline behaviour

- The main cloud workspace is explicitly view-only while offline until the business-data queue is implemented.
- The existing service worker caches only static assets, not private workspace HTML or API data.
- The architecture and idempotency contract for a genuine offline queue is documented but not falsely presented as complete.

### Product truth

- Customer, company, invoice and booking metrics are calculated from loaded records.
- Fixed calendar dates, fake staff availability and unsupported conflict-prevention claims were removed.
- Communications records no longer claim to send through Email, WhatsApp, Instagram or another provider.
- Generated replies are not presented as final or sent content.
- Documents no longer claim AI extraction or automatic filing when those integrations are disabled.
- Banking no longer presents a fabricated live balance or bank feed.
- Reports no longer contain fixed revenue charts, cash runway or profit figures.
- Automation is presented as stored configuration until the execution engine exists.
- Team-load failures are not allowed to appear as an empty team.
- Billing does not manufacture plan name, billing frequency or minimum contract length.

### Financial safety

- Cloud reconciliation is read-only until a single atomic command can update the transaction, invoice and activity records together.
- No partial transaction/invoice reconciliation is presented as successful.
- Invoice creation waits for database confirmation.
- The remaining invoice-number allocation risk is documented below.

### Vanita Stock

- Cloud saves are serialised instead of silently dropping a save while another save is running.
- The latest pending state is retained and retried when connectivity returns.
- Shared cloud state has an explicit revision.
- Stale-device writes raise a conflict instead of silently overwriting another staff member's changes.
- The dedicated schema defines `save_vanita_state` with optimistic concurrency.
- Empty cloud state is normalised to empty product, service, document, sale and activity collections rather than inheriting the demo seed.
- The production security policy permits only the pinned Supabase and barcode-scanner script versions used by the PWA.

## Remaining launch blockers

### 1. Quality Foundation database release

The following migrations are committed but not applied to hosted production:

- `20260718193000_quality_foundation_security.sql`
- `20260718193500_invitation_expiry_guard.sql`

Required before approval:

- production backup and recovery plan;
- migration dry run against a production-shaped disposable database;
- approved maintenance window;
- post-migration security and invitation checks;
- resend the currently pending invitation if its lifetime exceeds the approved one-hour limit.

### 2. Hosted authentication configuration

Supabase leaked-password protection remains disabled.

Required before approval:

- enable leaked-password protection;
- verify normal login, incorrect-password recovery, MFA and password-change flows;
- test invitation activation and expiry with the one-hour configuration.

### 3. Authenticated acceptance journeys

Public browser tests and disposable database tests are not sufficient.

Required journeys:

- owner login and workspace opening;
- first invitation activation;
- forced password change;
- MFA and Founder Admin;
- workspace switching;
- suspended user and suspended workspace denial;
- team invitation and role enforcement;
- customer, booking, message and document save failures;
- billing portal with a Stripe test customer;
- logout and session expiry.

### 4. Main BDB offline business-data queue

A genuine IndexedDB command queue, retry policy, idempotency keys and conflict UI are documented but not implemented.

Launch choices:

- implement and test the queue before claiming offline editing; or
- launch V1 with offline viewing/static-shell support only and keep all cloud mutations blocked while offline.

The current branch implements the second, honest option.

### 5. Invoice numbering and financial commands

Invoice numbers are still derived in the browser from loaded records. Two users creating invoices at the same time can choose the same next number.

Required before approval:

- server/database allocation of invoice numbers;
- unique database constraint verified in production;
- idempotent invoice-create command;
- atomic reconciliation command;
- permanent activity entry in the same transaction.

Owner: Matthew, supported by Niki.

### 6. Vanita dedicated cloud upgrade

The dedicated Vanita Supabase project must apply the updated schema before shared editing is enabled.

Required before approval:

- add `app_state.revision`;
- install `save_vanita_state(jsonb, bigint)`;
- test two-device conflict behaviour;
- verify storage policies and maximum document size;
- verify sale, edit, delete, supplier document and credit-note stock reversals;
- confirm no demo seed reaches the cloud workspace;
- back up existing Vanita `app_state` before the schema change.

### 7. External integrations

The following are not launch-ready capabilities unless explicitly excluded from the sold scope:

- external communication delivery;
- background automation execution;
- verified bank feed;
- automatic schedule availability/conflict engine;
- main BDB AI document extraction;
- advanced forecasting and profit reporting.

They must be either implemented and tested or clearly excluded from V1 contracts and product copy.

### 8. Operational release controls

Required before approval:

- enable required GitHub checks for `main`;
- require pull-request review;
- protect production environment variables;
- remove or disconnect the duplicate Vercel project;
- confirm production domains and redirects;
- confirm error monitoring, backups and escalation ownership;
- record rollback steps and the last known-good deployment;
- run desktop, tablet, mobile, keyboard and screen-reader review.

## Version 1 recommendation

Launch V1 with:

- Business Hub;
- customer records;
- confirmed appointments;
- confirmed invoice creation after server-side numbering is added;
- balances and payment states backed by verified commands;
- documents;
- internal communication records;
- notes and activity;
- local/static offline shell with cloud mutations blocked while offline;
- Vanita Stock only after its dedicated schema and two-device tests pass.

Delay or sell separately:

- background automation;
- external communication delivery;
- advanced AI agents;
- live bank reconciliation;
- forecasting;
- full offline editing and sync.

## Merge gate

This branch must not merge to `main` until:

1. all automated validation passes on the final head;
2. all remaining temporary patch workflows are removed;
3. the hosted migration and authentication gates are completed;
4. Matthew approves financial and Vanita integrity;
5. Giovanni approves product scope and commercial wording;
6. Niki approves architecture, build and rollback readiness;
7. the three founders explicitly approve the production merge.
