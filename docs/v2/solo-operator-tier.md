# BDB Solo Operator Tier

Status: launch-candidate product edition
Integrated branch: `codex/premium-operator-launch`
Parent: `v2/administrative-operator-foundation`

## Decision

Create BDB Solo as a workspace profile on the shared BDB OS platform for self-employed, appointment-led and client-service professionals who run administration themselves.

BDB Solo is not a separate application, database or design system. It reuses the shared customer, appointment, communication, invoice, payment, document and activity records and presents them through a simpler operator-led experience.

## Business problem

A solo professional is responsible for every department:

- delivering the paid work;
- managing customers;
- protecting the calendar;
- replying to enquiries;
- preparing invoices;
- tracking payment;
- filing documents;
- following up exceptions.

The problem is not a lack of dashboards. It is the constant switching between records and the repeated administrative work required to decide what happens next.

## Product owner

The primary product owner is the Business Hub because the tier connects work across departments. Individual record ownership remains unchanged:

- Customers owns customer identity and memory.
- Calendar owns appointments and availability.
- Communications owns inbound and outbound communication records.
- Accounts owns invoices, payments and balances.
- Documents owns original files and record links.
- Activity owns the permanent audit history.
- Operator owns workflow coordination, policy evaluation, approvals and exceptions.

## Target customer

Initial target:

> A self-employed, appointment-led or project-led service professional who manages customers, scheduling, communication and invoicing without dedicated administrative staff.

Examples include consultants, coaches, tutors, designers, photographers, therapists, beauticians, personal trainers and selected trades.

The first release must not attempt to support every self-employed profession with custom product forks.

## Product promise

> BDB Solo organises your customers, calendar, communications and money, prepares repetitive administration and brings you only the decisions that require you.

The branch must not claim to replace an employee until the V2 evidence standard is met.

## Navigation model

The Solo profile uses seven operating views:

1. Today
2. Customers
3. Calendar
4. Inbox
5. Money
6. Documents
7. Operator

This is a presentation profile only. It does not create duplicate routes, tables or business logic for the underlying departments.

## Implemented launch-candidate slice

The first implementation includes:

- a dedicated Solo shell using the shared BDB design tokens;
- a daily operator plan derived from live workspace records;
- priority ordering for overdue invoices, approval-gated messages and near-term appointments;
- connected customer summaries showing balance, unread communication, next booking and documents;
- appointment and reminder readiness views;
- communication triage without false provider-delivery claims;
- invoice and balance attention views without fabricated banking data;
- document linkage views;
- published, workspace-scoped autonomy policy controls;
- scheduled planning from canonical bookings, overdue invoices and messages;
- durable idempotent runs that survive closed browser tabs;
- approval, retry, stale-claim recovery and exception states;
- signed HTTPS webhook delivery and a clearly separated simulation provider;
- final source-record revalidation immediately before provider delivery;
- verified-versus-simulated time and cash evidence;
- a run ledger and exception desk in the client control room;
- atomic invoice numbering and finance reconciliation in the shared workspace;
- a public founder-review route with isolated fictional data;
- a protected route using the authenticated workspace;
- unit-tested pure decision logic.

## Routes

- Protected product route: `/solo-operator`
- Public no-index review route: `/solo-operator-preview`

The preview route generates date-relative fictional records in memory. It must never write those records into the production store or cloud workspace.

## Autonomy levels

Each workflow is governed independently:

### Assist

BDB organises the records, detects the next action and prepares the work. The owner completes the action.

### Approval

BDB prepares the complete action and asks the owner for explicit approval before external execution.

### Bounded autopilot

BDB may execute a low-risk action only when:

- the workflow is explicitly enabled;
- the provider is configured;
- the source record is verified;
- the action is idempotent;
- failure and retry behaviour are defined;
- the outcome is recorded;
- an exception owner exists.

### Human-only actions

The following remain human-controlled unless a later decision record changes the boundary:

- refunds;
- balance write-offs;
- accounting and tax classification;
- financial reconciliation;
- customer disputes;
- destructive stock corrections;
- legal commitments;
- sensitive customer communication;
- deletion of business records.

## Price justification

A price of approximately EUR 100 to EUR 150 per month is credible only when the Operator tier performs administrative work rather than merely displaying records.

The tier must earn the price through four outcomes:

### Protect the diary

- detect upcoming appointments;
- identify pending confirmations;
- apply reminder policy;
- prepare reminders;
- stop on cancellation or completion;
- surface scheduling exceptions.

### Stay on top of communication

- identify unread and sensitive messages;
- connect customer context;
- draft the appropriate next step;
- record sent, delivered, failed and replied states when providers are connected;
- escalate exceptions.

### Protect cash flow

- identify due and overdue invoices;
- confirm recorded payment state;
- prepare proportionate follow-up;
- stop when payment is received;
- escalate disputes or mismatches.

### Keep records complete

- preserve original documents;
- suggest the correct linked record;
- extract draft data with confidence and review states;
- prevent uncertain extraction from becoming an automatic financial or stock mutation.

## Commercial evidence threshold

Before positioning BDB Solo as equivalent to an administrative assistant, pilots must show:

- at least 80 percent of recurring target tasks completed without manual execution;
- less than one working day per week of routine administrative intervention;
- no silent data loss;
- no cross-workspace data exposure;
- no unrecorded external action;
- no duplicate financial, communication or appointment action caused by retry;
- all exceptions assigned and visible;
- measurable reduction in administrative hours;
- successful operation across multiple real solo businesses for several weeks.

For the initial EUR 100 to EUR 150 proposition, the commercial target is to return at least eight hours per month or recover equivalent value through protected bookings and faster payment.

## Offline behaviour

The current shared workspace remains view-only when offline.

Bounded autopilot cannot execute provider actions while offline. A future offline command system must include:

- durable local commands;
- idempotency keys;
- retry state;
- per-record sync state;
- conflict detection;
- explicit cancellation;
- permanent outcome history.

The interface must never label a local draft as sent, paid, reconciled or synced.

## Design requirements

The Solo tier must preserve the BDB OS identity:

- dark charcoal foundation;
- restrained dark-gold accent;
- premium, calm surfaces;
- strong contrast on primary actions;
- minimal clutter;
- customer-centred context;
- clear operating hierarchy;
- responsive desktop, tablet and mobile behaviour;
- reduced-motion support;
- accessible focus states.

It should feel like a calm operating room for one person, not a reduced generic SaaS dashboard.

## Architecture boundaries

- Do not duplicate customer, appointment, invoice, message or document models.
- Do not copy the full workspace pages into Solo-specific variants.
- Keep decision derivation pure and testable.
- Keep provider execution server-side and idempotent.
- Keep AI output as a proposal until the workflow policy permits execution.
- Keep preview data isolated from the shared store.
- Do not add a new product database.
- Do not merge V2 into `main` before the launch-readiness foundation is approved.

## First production workflow

The first end-to-end workflow remains appointment reminders:

1. Observe a verified upcoming appointment.
2. Evaluate reminder policy and customer preference.
3. Check cancellation, completion and prior reminder state.
4. Prepare the message.
5. Request approval or execute within the bounded policy.
6. Confirm provider acceptance.
7. Record delivery, failure or reply.
8. Retry safely or create an exception.
9. Stop when the appointment state changes.

## Review ownership

### Giovanni

- target customer and onboarding;
- daily experience and wording;
- commercial packaging;
- whether the tier feels simpler than the full workspace;
- pilot recruitment and outcome measurement.

### Matthew

- provider integrations;
- workflow execution;
- bounded AI drafting;
- delivery receipts and retries;
- exception routing;
- automation observability.

### Niki

- shared record architecture;
- policy and command models;
- idempotency and data integrity;
- offline command architecture;
- security, testing and rollback;
- preventing product forks and duplicate logic.

## Merge gates

This branch remains draft until:

- the V1 launch-readiness foundation is merged or equivalently rebased;
- the shared CI suite passes;
- the public review route passes browser validation;
- authenticated Solo routing is tested in a configured QA workspace;
- the Solo experience is reviewed on desktop, tablet and mobile;
- the first workflow has a server-side command contract;
- all three founders approve the product direction;
- no employee-replacement claim is used without pilot evidence.
