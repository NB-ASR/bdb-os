# BDB OS V2 Definition of Done

## Purpose

This document defines the evidence required before BDB OS may claim that it performs most of a narrowly defined administrative operations role.

Passing a build, producing plausible AI text or completing a staged demo does not satisfy this definition.

## Target role

The initial target is a **small-business administrative operations coordinator** responsible for routine work involving:

- customer records
- appointment administration
- invoice and balance follow-up
- routine customer communication
- document intake
- stock and reorder administration
- daily task and exception coordination

The target does not include professional bookkeeping, financial management, dispute resolution, tax judgement or general operations management.

## Product definition of done

### Connected records

- [ ] Every workflow reads and writes canonical BDB OS records.
- [ ] No workflow maintains a private copy of customer, appointment, invoice, payment, document or stock truth.
- [ ] Every workflow action is visible in the relevant customer or business history.
- [ ] Cross-department navigation reaches the affected record directly.

### Workflow completeness

- [ ] The normal path is implemented end to end.
- [ ] Approval requirements are explicit.
- [ ] External provider success is verified.
- [ ] Retries are bounded and observable.
- [ ] Timeouts produce a visible exception.
- [ ] Cancellation is supported where the business action remains reversible.
- [ ] Compensation or recovery is defined for partial failure.
- [ ] The workflow stops when the underlying business condition is resolved.

### Operations inbox

- [ ] Approvals, failures, conflicts and ambiguous cases appear in one Business Hub inbox.
- [ ] Every item has a named owner, due state and affected record.
- [ ] Items cannot disappear because a browser tab was closed.
- [ ] Resolved items retain permanent history.

### Business policy

- [ ] Businesses can configure opening hours, reminders, payment terms, escalation contacts and approval limits.
- [ ] Every workflow records the policy version it used.
- [ ] Policy changes do not silently rewrite completed history.
- [ ] Unsafe or contradictory policy is rejected with a plain-language explanation.

## Reliability definition of done

### Persistence

- [ ] The interface never reports success before persistence is confirmed.
- [ ] Failed writes leave the user with an actionable state.
- [ ] Duplicate commands are idempotent.
- [ ] Partial financial or stock updates are impossible.
- [ ] Query failures cannot appear as empty datasets.
- [ ] No demo or seeded data can enter a configured customer workspace.

### Concurrency

- [ ] Record revisions are checked before sensitive updates.
- [ ] Two-device conflicts are detected.
- [ ] Stale edits cannot overwrite newer data silently.
- [ ] Conflict resolution is understandable to a business user.

### Offline operation

- [ ] Offline-readable records are clearly identified.
- [ ] Offline commands are stored durably in IndexedDB.
- [ ] Each command has a stable identifier and visible state.
- [ ] Sync retries survive reloads and device restarts.
- [ ] Conflicts are revalidated before execution.
- [ ] Duplicate invoices, payments and stock movements are prevented.
- [ ] Financial and stock actions remain blocked until their offline contract is proven.

### External integrations

- [ ] Provider credentials remain server-side.
- [ ] Delivery states are durable.
- [ ] Rate limits and provider outages are handled.
- [ ] Webhooks or polling are idempotent.
- [ ] Provider failure cannot be displayed as sent, paid, booked or reconciled.

## Security definition of done

- [ ] Every workflow executes in an authenticated workspace context.
- [ ] RLS and server checks prevent cross-workspace access.
- [ ] Role and suspension rules apply to automated actions.
- [ ] High-risk commands require the declared human approval.
- [ ] Approval records cannot be forged from the client.
- [ ] Secrets and full access tokens are excluded from logs.
- [ ] Sensitive AI inputs follow the approved retention policy.
- [ ] Security and isolation tests run in CI.

## AI definition of done

- [ ] Each AI capability has a bounded purpose.
- [ ] Model output is treated as untrusted input.
- [ ] Structured output is schema-validated.
- [ ] Business facts are rechecked against canonical records.
- [ ] Confidence or ambiguity is surfaced where relevant.
- [ ] Low-confidence cases create exceptions rather than automatic actions.
- [ ] Prompt, model and policy versions are traceable.
- [ ] Model failure has a non-AI fallback or clear manual path.
- [ ] No model receives unrestricted database write access.

## User-experience definition of done

- [ ] The owner can understand why an action was proposed or performed.
- [ ] The affected customer and business records are visible.
- [ ] Approval requires a clear, deliberate action.
- [ ] Risky destructive actions remain distinguishable from routine approvals.
- [ ] Saving, syncing, waiting, failed and conflicted states are visually distinct.
- [ ] Keyboard and screen-reader workflows are usable.
- [ ] Mobile workflows remain complete, not merely viewable.
- [ ] Reduced-motion and theme behaviour remain consistent with BDB OS.
- [ ] The interface feels like one Business OS, not a collection of agent dashboards.

## Testing definition of done

### Automated

- [ ] TypeScript passes.
- [ ] ESLint passes.
- [ ] Unit and contract tests pass.
- [ ] Migration replay passes from an empty database.
- [ ] RLS and pgTAP isolation tests pass.
- [ ] Workflow state-machine tests pass.
- [ ] Idempotency and duplicate-delivery tests pass.
- [ ] Failure-injection tests pass.
- [ ] Public and authenticated Chromium journeys pass.
- [ ] Offline queue and reconnection journeys pass.
- [ ] Provider sandbox journeys pass.

### Manual

- [ ] Desktop, tablet and mobile acceptance passes.
- [ ] Keyboard-only review passes.
- [ ] Screen-reader review passes for the operations inbox and approvals.
- [ ] Two-device conflict testing passes.
- [ ] Provider outage and delayed-delivery testing passes.
- [ ] Rollback is rehearsed.
- [ ] Business users can resolve exceptions without developer assistance.

## Pilot evidence definition of done

The phrase **"replace an administrative employee"** must not be used publicly until all of the following are demonstrated in controlled pilots:

- [ ] The exact target role and task list are documented before the pilot.
- [ ] At least 80% of recurring target tasks complete without manual execution.
- [ ] Routine human intervention is below one working day per week.
- [ ] No silent data loss occurs.
- [ ] No cross-workspace or privacy incident occurs.
- [ ] Every financial and stock action is auditable.
- [ ] Exception handling meets the agreed response time.
- [ ] Customer communication errors remain below the approved threshold.
- [ ] At least three businesses complete the pilot.
- [ ] Each pilot runs for multiple consecutive weeks.
- [ ] Administrative hours are measured before and after adoption.
- [ ] The owner confirms that workload was removed rather than merely moved into reviewing software.

Until those gates pass, the approved commercial wording is:

> BDB OS removes repetitive administration, helps one person manage more work and can help a growing business avoid its next administrative hire.

## Workflow-specific release gates

### Appointment administration

- [ ] Conflict detection uses verified availability.
- [ ] Reminder delivery is confirmed by the provider.
- [ ] Rescheduling respects business policy and staff permissions.
- [ ] Customer replies update the appointment state.
- [ ] Cancellations and unusual requests escalate correctly.

### Invoice follow-up

- [ ] Invoice numbers are allocated server-side and unique.
- [ ] Payment and reconciliation commands are atomic.
- [ ] Follow-up stops immediately after verified payment.
- [ ] Partial payments and disputes create exceptions.
- [ ] Reminder tone and schedule follow business policy.

### Inbox triage

- [ ] Messages are linked to the correct customer with measurable accuracy.
- [ ] Ambiguous identity creates an exception.
- [ ] Drafts include the relevant record context.
- [ ] Sensitive categories cannot auto-send.
- [ ] Delivery and reply states are durable.

### Document intake

- [ ] Original files are stored before structured records appear.
- [ ] Extraction confidence and discrepancies are visible.
- [ ] Duplicate documents are detected.
- [ ] Financial and stock commands remain approval-gated until proven.
- [ ] Failed metadata writes clean up or surface orphaned storage.

### Stock administration

- [ ] Every stock change has a movement record.
- [ ] Sales, supplier documents and manual adjustments remain reconcilable.
- [ ] Reorder suggestions use real movement data.
- [ ] Conflicting revisions cannot overwrite silently.
- [ ] Returns and deletions reverse stock safely.

## Founder approval

- [ ] Giovanni approves the target role, business simplicity and customer-facing claim.
- [ ] Matthew approves workflow automation, integrations and AI boundaries.
- [ ] Niki approves architecture, security, offline behaviour, performance and rollback readiness.

## Merge rule

The V2 branch remains draft until the relevant definition-of-done sections are supported by evidence in the pull request.

A checklist item may not be marked complete because the code path exists. It requires a test, pilot result, provider confirmation or recorded manual acceptance appropriate to the claim.