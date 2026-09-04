# BDB OS V1 Engine Closure Standard

## Decision

An engine is **not V1 Closed** merely because its schema, APIs, security rules, migrations, static contracts, scale tests or builds are green.

`V1 Closed` means the engine is safe, integrated **and operationally usable by a real customer on the exact release candidate**.

This rule applies to every future engine closure and retroactively governs repairs to engines already labelled V1 Closed.

## Business problem

BDB OS previously proved deep technical integrity while allowing visible business actions to remain misleading, disabled or untested in an authenticated browser. That creates avoidable onboarding failures even when the underlying architecture is sound.

A business user does not experience a database contract. They experience buttons, file pickers, forms, imports, searches, documents, retries and cross-department workflows. Closure must prove those customer-visible workflows too.

## Ownership

This is a shared release-quality rule owned by the BDB OS platform/release process. Every department-specific engine must satisfy it before its V1 freeze can be declared.

## Required four passes

The existing four-pass discipline remains mandatory:

1. **Core correctness** — lifecycle, validation, permissions, tenancy, concurrency and idempotency.
2. **Offline reliability** — bounded cache/queue behaviour, stable retry identity, recovery and explicit cloud-only boundaries.
3. **Scale/performance** — bounded reads, search/pagination, realistic data volumes and query plans.
4. **Cross-department closure + freeze** — ownership boundaries, downstream references, historical snapshots and regression protection.

Passing these four technical passes makes an engine a **closure candidate**, not a closed engine.

## Mandatory Customer Operational Acceptance Gate

After Pass 4, and before merge/freeze, the exact candidate must pass a customer-facing acceptance gate.

### 1. Visible-action inventory

Every visible business action on every in-scope screen must be listed and classified as one of:

- **Operational V1** — must work end-to-end and be tested.
- **State-dependent** — may be disabled only when the current record/session genuinely makes the action unavailable; the enabling condition must be tested.
- **Deferred** — must not be presented as an apparently available business action. Hide it or label it explicitly as unavailable/future work.

A permanently disabled button that looks like a normal business action is not acceptable on a V1-closed screen.

### 2. Authenticated end-to-end proof

The exact candidate must be exercised as a real workspace owner/operator, not only through public browser checks.

For every Operational V1 action, prove the full customer journey including the resulting persisted business state. Examples include:

- create/edit/archive/restore;
- search/filter/pagination;
- file selection and accepted file types;
- import preview/validation/import result;
- document upload/download/print where in scope;
- approval/posting/receive actions;
- cross-department handoffs;
- retry/error/recovery states where material.

A static source assertion that a button or route exists does not count as operational acceptance.

### 3. File-operation proof

Any customer-facing import/upload/export action must be tested using representative real files of every advertised supported format.

The browser file picker, parser, validation, duplicate handling, persistence and final UI result must all be proven.

The label must accurately describe the supported formats and workflow. A legacy migration-only importer must not be presented as a generic business import feature.

### 4. Exact-candidate environment proof

Any required cloud capability must be verified in the target environment before the engine is called live. This includes required environment configuration, storage access, AI providers and external services.

A build being READY is not proof that a feature-specific environment dependency is configured.

### 5. No dead controls

Closure must fail if an in-scope screen contains an unconditional disabled business action or a visible placeholder that a customer could reasonably interpret as functional.

Legitimate permission-, connectivity-, record-state- or pending-operation disabling is allowed when the reason is explicit and tested.

### 6. Customer acceptance checklist

The closure PR must contain a screen-by-screen checklist showing:

- visible action;
- expected customer outcome;
- automated test covering it;
- exact-candidate browser result;
- Production verification after merge.

No unchecked Operational V1 action may remain when the PR is marked ready to merge.

## Merge and live rule

The sequence is now:

`Pass 1 → Pass 2 → Pass 3 → Pass 4 → Customer Operational Acceptance → exact-head green → merge → Production verification → V1 Closed/Live`

Do not use `V1 Closed`, `V1 Frozen` or `V1 Live` before the Customer Operational Acceptance Gate has passed.

## Deferred functionality rule

Deferring a feature is valid V1 discipline. Presenting a deferred feature as a broken control is not.

For deferred functionality:

- remove the normal action from the customer UI; or
- present a clearly non-interactive future-state explanation outside the normal action hierarchy.

Never use an unexplained permanently disabled primary/secondary action as a roadmap placeholder.

## Offline rule

Offline-first remains mandatory for normal business operations where technically appropriate. Legitimately cloud-dependent actions, such as AI extraction, may pause offline, but the UI must say so clearly and preserve the user's captured work safely.

Operational acceptance must test both the offline-capable path and the explicit cloud-only boundary.

## Freeze rule

Once this full standard passes, the engine can be frozen. Later defects may be repaired without reopening architecture, but every repair must preserve the operational acceptance tests that protect already-shipped customer workflows.

## Application to Documents

Purchasing Documents is the next planned engine closure. It must not be declared V1 Closed until a real customer can successfully execute the complete in-scope journey on the exact candidate, including file upload, extraction when configured, review, Product/Supplier resolution, approval, Inventory handoff, recovery states and every visible customer action.
