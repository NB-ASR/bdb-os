# ADR-002: Bounded Autonomy for the BDB OS Administrative Operator

## Status

Proposed on `v2/administrative-operator-foundation`.

## Decision

BDB OS will implement administrative automation as a set of bounded, record-connected workflows executed through validated server commands.

The system will not use a general-purpose autonomous agent with unrestricted access to workspace records.

Every workflow must declare:

- its owning department
- the canonical records it reads and changes
- its trigger
- its autonomy level
- its business policy inputs
- its allowed commands
- its approval requirements
- its retry and timeout behaviour
- its compensation or recovery path
- its exception owner
- its offline behaviour
- its audit events

## Context

The intended V2 value is to absorb repetitive administrative workload across customers, appointments, invoices, payments, communications, documents and stock.

A free-form agent could appear faster to build, but it would weaken the product in the areas that matter most:

- predictable business behaviour
- multi-tenant isolation
- financial and stock integrity
- offline reliability
- explainability
- customer trust
- testability

The system therefore needs autonomy that is earned workflow by workflow.

## Autonomy levels

### Level 0: Observe

Reads verified records and creates an explanation or task. No business mutation.

### Level 1: Draft

Creates a proposed message, command payload or recommendation. A person must initiate the action.

### Level 2: Approval required

The workflow is complete but pauses before a sensitive command. Approval is stored as a durable business record.

### Level 3: Bounded autopilot

The workflow may execute a predefined low-risk command under explicit business policy. It must verify the result and surface failures.

### Level 4: Human-only

The system may prepare information but never execute the action autonomously.

## Risk classes

### Low risk

Examples:

- send a routine appointment reminder
- retry a failed reminder delivery
- create an internal follow-up task
- classify an inbound message

These actions may reach Level 3 after pilot evidence.

### Medium risk

Examples:

- send an overdue invoice reminder
- reschedule an appointment
- update customer communication preferences
- prepare a supplier reorder

These actions normally require Level 2 approval until business-specific evidence supports a narrower policy.

### High risk

Examples:

- refund or write off money
- mark a payment as reconciled
- delete financial or stock history
- override a stock conflict
- change tax handling
- send legal or dispute-related communication

These actions remain Level 4 unless a future decision record explicitly changes the boundary.

## Execution contract

A workflow cannot write directly to department tables.

It must call a shared server command that provides:

1. authenticated workspace context
2. role and permission checks
3. validated input
4. idempotency enforcement
5. atomic transaction behaviour where needed
6. canonical record updates
7. permanent activity logging
8. structured success or failure output

The workflow treats an action as complete only after the command and any external provider confirm the required result.

## AI contract

AI is permitted for:

- classification
- extraction
- summarisation
- drafting
- recommendation
- anomaly explanation

AI output is untrusted input.

It must be validated against current business records and converted into either:

- a proposed action
- an approval request
- a validated server command

AI may not determine balances, payment status, stock quantities, permissions, appointment availability or delivery success without verified system data.

## Workflow state model

Each workflow instance must have a durable state such as:

- pending
- evaluating
- awaiting_approval
- queued
- executing
- verifying
- completed
- retry_scheduled
- failed
- conflicted
- cancelled
- compensated

State changes must be append-only in the audit history even when the current workflow record is updated.

## Approval model

An approval record must include:

- workspace
- workflow instance
- proposed command
- affected records
- risk class
- reason
- policy version
- requested approver role
- requesting actor or workflow
- approval or rejection identity
- decision time
- optional note
- expiry time where relevant

Approval is not represented by a temporary modal state.

## Exception model

Every exception must have:

- a stable identifier
- workflow and record links
- severity
- customer-visible impact
- retryability
- current owner
- due time
- explanation in plain language
- technical diagnostic reference
- resolution outcome

Exceptions appear in the shared Business Hub operations inbox.

## Offline behaviour

The interface may prepare a command offline only when the workflow declares an offline-safe command contract.

Offline commands require:

- a stable local identifier
- durable IndexedDB storage
- captured record revisions
- idempotent server execution
- revalidation before mutation
- explicit pending and conflicted states
- user-visible resolution when the shared record changed

Financial and stock mutations remain blocked offline until their atomic command and conflict behaviour are proven.

## Security and privacy

- Workflows execute only in an authenticated workspace context.
- Cross-workspace lookups are forbidden.
- Provider credentials remain server-side.
- Sensitive message content and model inputs must follow data-retention policy.
- Workflow logs must not store secrets or full provider tokens.
- Automated actions must respect suspension, role and approval restrictions.

## Observability

Each execution records:

- workflow definition and version
- policy version
- trigger
- affected record identifiers
- autonomy level
- command identifier
- idempotency key
- provider request reference where applicable
- verification result
- retries
- timing
- exception reason

## Alternatives considered

### General-purpose autonomous agent

Rejected because it is difficult to constrain, test, explain and operate offline. It would also encourage direct writes and duplicate business logic.

### Separate AI agent per department

Rejected because it would create competing task queues, duplicated customer context and inconsistent approval behaviour.

### Cloud-only workflow execution

Rejected as the long-term architecture because BDB OS requires resilient local operation. Cloud execution remains necessary for providers and shared commands, but the client must retain durable pending work and transparent sync state.

### UI-only automation

Rejected because browser state cannot guarantee delivery, atomicity, retry behaviour or permanent audit history.

### Silent background retries

Rejected because repeated failure can change customer outcomes. Retries must be bounded, observable and escalated.

## Consequences

### Positive

- predictable and testable automation
- clear ownership
- reusable command and approval infrastructure
- safer financial and stock behaviour
- honest offline semantics
- explainable customer outcomes
- measurable autonomy progression

### Negative

- slower initial implementation than a free-form agent demo
- more schema and workflow-runtime work
- external integrations require explicit adapters
- autonomy must be proven one workflow at a time

These costs are accepted. The goal is operational software, not an impressive video of a chatbot clicking buttons.