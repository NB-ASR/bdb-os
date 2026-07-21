# BDB OS V2 Administrative Operator Roadmap

## Status

Draft product and architecture contract for branch `v2/administrative-operator-foundation`.

This branch depends on the security, reliability and data-integrity foundation currently reviewed in `qa/launch-readiness-hardening-v1`. It must not be merged directly into `main` until that foundation has either reached `main` or this branch has been rebased onto an equivalent approved base.

## Product mission

BDB OS V2 should absorb most recurring work performed by a small-business administrative operations coordinator, while the owner or staff member handles approvals, sensitive judgement and unusual exceptions.

The intended commercial progression is:

1. Reduce repetitive administration.
2. Allow one person to manage the workload of a larger team.
3. Avoid the next administrative hire.
4. After measured customer evidence, perform most of a narrowly defined administrative role.

BDB OS must not claim to replace a generic employee. The supported role is deliberately narrow and measurable.

## Business problem

Small service businesses lose time and accuracy because customer, appointment, invoice, payment, document, communication and stock work is split across separate tools and manual follow-up.

The V2 operator solves this by owning complete administrative workflows across connected records, rather than presenting isolated buttons or disconnected AI suggestions.

## Product owner

The V2 operator is owned by the **Business Hub / Operations** domain.

Individual departments retain authority over their records:

- Customers owns customer identity and preferences.
- Calendar owns appointments and availability.
- Accounts owns invoices, payments and balances.
- Communications owns message history and delivery state.
- Documents owns stored files and extraction state.
- Inventory owns products and stock movements.
- Settings owns business policies and approval rules.

The operator coordinates these departments. It does not create separate shadow records.

## Records the operator must connect

Every workflow must attach to one or more canonical records:

- customer
- appointment
- invoice
- payment
- balance
- document
- communication
- stock item
- stock movement
- business task
- exception
- approval
- permanent activity event

A workflow without a canonical business record is not part of V2.

## Operating model

Every automated workflow follows the same sequence:

1. **Observe** a verified business event or scheduled condition.
2. **Evaluate** business policy and current record state.
3. **Propose** the next action with reasons and affected records.
4. **Approve or execute** according to the workflow's autonomy level.
5. **Run a server command** with idempotency and permission checks.
6. **Verify** the external and internal result.
7. **Record** a permanent activity event.
8. **Escalate** any retry, conflict or exception to a named owner.

No workflow may update the interface optimistically and infer that the business action succeeded.

## V2 autonomy levels

### Level 0: Observe

The system detects and explains work but does not prepare or perform an action.

Examples:

- Flag a likely duplicate customer.
- Identify an overdue invoice.
- Highlight a possible stock discrepancy.

### Level 1: Draft

The system prepares an action for a person to edit and initiate.

Examples:

- Draft an invoice reminder.
- Suggest appointment slots.
- Prepare extracted supplier-document lines.

### Level 2: Approval required

The system prepares a complete action and waits for explicit approval.

Examples:

- Send a payment reminder.
- Confirm a rescheduled appointment.
- Create a supplier reorder draft.

### Level 3: Bounded autopilot

The system executes a low-risk action automatically under explicit business policy, then verifies and records it.

Examples:

- Send a routine appointment reminder.
- Retry a failed non-sensitive delivery.
- Create a follow-up task when a customer does not respond.

### Level 4: Human-only

The system may explain or prepare information but must never execute the action autonomously.

Examples:

- Refund a payment.
- Write off a balance.
- Delete financial or stock history.
- Resolve a customer dispute.
- Change tax treatment.
- Override a stock conflict.

## Initial replacement workflows

### 1. Appointment administration

Connected records: customer, appointment, communication, task, exception.

Target workload:

- Suggest valid appointment times.
- Detect conflicts.
- Send reminders.
- Record confirmations.
- Follow up on non-response.
- Offer approved rescheduling options.
- Escalate cancellations and unusual requests.

Offline requirement:

- Existing schedule and customer preferences remain readable.
- New or changed appointments are queued as idempotent commands.
- Conflicts are revalidated before sync completion.

### 2. Invoice and balance follow-up

Connected records: customer, invoice, payment, balance, communication, task, exception.

Target workload:

- Detect overdue invoices.
- Confirm no payment or reconciliation already exists.
- Apply business-specific reminder rules.
- Draft or send the reminder at the permitted autonomy level.
- Stop follow-up immediately after payment.
- Escalate disputes, partial payments and repeated failure.

Offline requirement:

- Financial records remain readable.
- Financial mutations remain blocked until the atomic finance command and safe offline command queue are proven.

### 3. Inbox triage and customer follow-up

Connected records: customer, communication, appointment, invoice, task, exception.

Target workload:

- Classify inbound messages.
- Link the message to the correct customer and business record.
- Summarise the relevant history.
- Draft a response.
- Route sensitive or ambiguous cases to a person.
- Track delivery, reply and follow-up state.

External dependency:

- At least one production-grade email or messaging integration is required before this workflow can move beyond draft mode.

### 4. Document intake

Connected records: document, customer or supplier, invoice, stock movement, task, exception.

Target workload:

- Store the original file.
- Extract structured fields.
- Match existing records.
- Show confidence and discrepancies.
- Prepare the resulting command.
- Require approval for financial or stock changes until accuracy is proven.

Offline requirement:

- Files can be captured locally with a visible pending state.
- Extraction and cloud storage run only when connected.
- Duplicate submission is prevented by a stable local command identifier.

### 5. Stock and reorder administration

Connected records: product, stock movement, supplier document, sale, task, exception.

Target workload:

- Detect low stock from verified movement data.
- Estimate reorder quantities from real consumption and policy.
- Prepare supplier reorder drafts.
- Detect conflicting or stale stock changes.
- Escalate discrepancies rather than choosing a silent winner.

Offline requirement:

- Local stock operations require revision-aware commands and conflict resolution.
- No device may overwrite a newer shared revision silently.

## Shared platform capabilities required

### Workflow runtime

A durable state-machine runtime must support:

- scheduled triggers
- record-event triggers
- idempotent execution
- retries with backoff
- timeout handling
- approval pauses
- cancellation
- compensation steps
- permanent audit history

### Command boundary

All mutations must use shared server commands with:

- authenticated workspace context
- permission checks
- validated inputs
- idempotency keys
- atomic database behaviour where required
- verified output
- permanent activity logging

### Operations inbox

The Business Hub must contain one unified operations inbox for:

- work awaiting approval
- failed workflows
- conflicts
- ambiguous records
- integration failures
- overdue exceptions

Departments may filter their own work, but they must not create separate competing inboxes.

### Business policy

Settings must capture the rules an administrative coordinator would otherwise learn informally:

- opening hours
- staff responsibilities
- appointment rules
- cancellation policy
- payment terms
- reminder sequence and tone
- communication preferences
- approval limits
- stock thresholds
- escalation contacts
- quiet hours

### Communication delivery

Every outbound message must have a durable state:

- drafted
- awaiting approval
- queued
- sent
- delivered
- failed
- replied
- cancelled

A communication recorded in BDB OS is not considered sent until the provider confirms acceptance.

### Offline command queue

The shared queue must provide:

- durable IndexedDB storage
- stable command identifiers
- idempotent server execution
- explicit pending, syncing, failed and conflicted states
- retry policy
- user-visible conflict handling
- prevention of duplicate invoices, payments and stock movements

### Observability

Every automated action requires:

- workflow identifier
- initiating event
- affected records
- policy version
- autonomy level
- model or rule version where applicable
- approval identity when required
- command result
- retry history
- exception reason

## AI boundaries

AI may assist with classification, extraction, summarisation, drafting and recommendation.

AI must not be the source of truth for:

- balances
- payment status
- stock quantity
- tax values
- appointment availability
- permission decisions
- successful delivery
- successful persistence

Those values must come from verified records or external provider responses.

No general-purpose agent receives unrestricted database write access. AI output must be converted into a validated command or an approval request.

## Delivery phases

### Phase 0: Foundation

- Shared workflow data model.
- Command and idempotency contract.
- Approval and exception records.
- Operations inbox.
- Business policy model.
- Offline command-queue design and prototype.
- Integration adapter contract.

Exit condition: one workflow can run end to end in a test environment with full audit history and deliberate failure injection.

### Phase 1: Assisted operator

- Appointment suggestions.
- Overdue-invoice detection.
- Message classification and drafts.
- Document extraction review.
- Stock reorder suggestions.

All external or financial actions require human initiation or approval.

Exit condition: the system measurably reduces administrative preparation time without making autonomous changes.

### Phase 2: Approval operator

- Complete approval queue.
- Provider-backed sending.
- Verified reminders and follow-ups.
- Retry and escalation handling.
- Policy-driven approval limits.

Exit condition: a person primarily reviews exceptions and approvals rather than manually assembling each action.

### Phase 3: Bounded autopilot

- Automatic low-risk appointment reminders.
- Automatic routine follow-up tasks.
- Automatic delivery retries.
- Automatic closure when the verified business condition is satisfied.

Exit condition: each autonomous workflow has a measured error rate, rollback or compensation behaviour and explicit business opt-in.

### Phase 4: Replacement proof

Run controlled pilots in the intended customer segment.

The replacement claim is allowed only when pilots demonstrate:

- at least 80% of the target role's recurring tasks completed without manual execution
- zero silent data-loss or cross-workspace incidents
- 100% auditability for financial and stock actions
- exceptions surfaced within the agreed service level
- less than one working day per week of routine human intervention
- sustained performance across multiple businesses and several weeks
- measured administrative hours saved before and after adoption

## Explicit non-goals

V2 is not:

- a general autonomous employee
- an autonomous bookkeeper
- an autonomous finance manager
- a free-form chatbot with write access
- a replacement for owner judgement
- a collection of separate department bots
- a promise that every integration works offline

## Ownership lanes

### Giovanni

- Define the target customer segment and administrative role.
- Approve customer-facing claims.
- Define business policies and exception language.
- Validate whether workflows are commercially valuable and simple.

### Matthew

- Own workflow automation, integrations, communications providers and bounded AI capabilities.
- Implement the atomic finance command before financial automation.
- Define provider delivery and retry contracts.

### Niki

- Own workflow architecture, command integrity, database design, offline queue, security, performance and observability.
- Prevent duplicate logic and cross-workspace data leakage.
- Maintain test and release gates.

## Merge gates

This branch must not merge into `main` until:

1. The V1 launch-readiness foundation is on `main` or this branch is rebased onto its approved equivalent.
2. Workflow and approval schemas pass migration replay and isolation tests.
3. At least one complete workflow passes authenticated browser testing.
4. Offline and retry behaviour is tested through deliberate failure injection.
5. No workflow claims external success without provider confirmation.
6. Giovanni approves the commercial promise and workflow simplicity.
7. Matthew approves integration and automation boundaries.
8. Niki approves architecture, data integrity and rollback readiness.

## Immediate implementation order

1. Define workflow, approval, exception and policy schemas.
2. Define the server-command and idempotency interface for workflows.
3. Build the operations inbox using test records.
4. Implement one narrow appointment-reminder workflow end to end.
5. Add a provider adapter in sandbox mode.
6. Add failure injection, retries and audit history.
7. Add offline command queuing only after the online command contract is stable.
8. Measure the workflow before introducing additional AI or automation.

The first working slice should be small, complete and boringly reliable. That is how BDB OS earns the right to become more autonomous.