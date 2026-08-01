# Unified Communications Integration

## Decision

BDB OS uses **Communications** as the authoritative owner of communication threads, message records, read state, draft-review state and thread lifecycle.

Customers remains the authoritative owner of Customer identity and contact details. Communications references an exact Customer and does not copy a separate Customer profile.

Version 1 records communication activity inside BDB OS. It does not claim that Email, WhatsApp, Instagram or Web messages were delivered through an external provider.

## Business problem

The existing Communications page stores flat message records through the shared browser store. It cannot reliably answer:

- Which messages belong to the same conversation?
- Was a message inbound or outbound?
- Which reply belongs to which thread?
- Has an inbound message been read?
- Is an AI-assisted draft still awaiting a human decision?
- Can a recorded message replay safely after an offline interruption?
- Can Customer 360 show the authoritative communication event without duplicating Customer data?

Direct browser writes also bypass the trusted command, support-access and idempotency patterns used by the integrated departments.

## Ownership

### Communications owns

- Thread identity
- Message identity and immutable message content
- Channel and direction
- Subject and recorded body
- Reply relationships
- Read state for inbound messages
- Draft-review and dismissal state
- Open or closed thread lifecycle
- Communication command receipts
- Communication activity events

### Customers owns

- Customer identity
- Customer name, company and contact details
- Customer access rules
- Customer 360 presentation of linked communication records

A Communication command never changes Customer identity or contact information.

## Version 1 channels

- `Email`
- `WhatsApp`
- `Instagram`
- `Web`

Connections to external providers are deferred. The V1 workflow records what was received or sent outside BDB OS, or what was written for later human delivery.

## Thread model

Every message belongs to one exact thread.

A thread belongs to one workspace, one Customer and one channel. Replies stay inside that boundary. Threads may be closed and later remain readable; V1 does not silently reopen a closed thread.

Legacy messages receive one thread each. The migration does not group old messages by free-text subject because that could invent a relationship.

## Message model

Messages are append-only business records. New messages contain:

- Direction: `inbound` or `outbound`
- Subject
- Full recorded body
- Occurrence timestamp
- Optional reply-to message
- Optional draft-review state
- Actor and command identity

Message content is not edited after creation. Read state and draft-review state are controlled lifecycle fields changed only through trusted commands.

## AI boundary

AI may assist with a draft, but the draft remains in `review` until a human records a final outbound message or dismisses the draft.

BDB OS must never represent an AI draft as sent, delivered or approved automatically.

## Command boundary

Trusted server commands own:

- Recording a new thread and first message
- Recording a message in an existing thread
- Marking an inbound message as read
- Dismissing a draft under review
- Closing a thread

Every command uses a stable idempotency key. Exact retries return the original result.

Browser clients retain RLS-scoped reads only. Direct browser inserts, updates and deletes on Communications tables are removed.

## Offline boundary

After one successful online load, the unified inbox may be cached per workspace.

Version 1 offline-capable commands are:

- Record inbound communication
- Record outbound communication
- Mark inbound communication as read
- Dismiss a draft under review
- Close a thread

Commands replay in order and stop at the first conflict or validation error. A queued outbound record is shown as pending, not as provider-delivered.

## Customer 360 and Documents

Customer 360 reads Communication activity from the authoritative Communications records.

General Documents may link to an exact message record. Documents owns the file; Communications owns the message.

## Side-effect boundary

Communication commands do not create, update, settle or reverse:

- Customers
- Appointments
- Sales
- Invoices
- Customer Payments
- Supplier records
- Inventory movements
- Bank transactions
- Documents

## Version 1 boundary

Included:

- Unified thread index
- Inbound and outbound message records
- Exact Customer linkage
- Human-controlled draft review
- Read state
- Thread closure
- Trusted idempotent commands
- Ordered offline replay
- Customer 360 activity integration
- Founder-support read-only enforcement

Deferred:

- Provider sending and receiving
- OAuth connection setup
- Webhooks
- Delivery receipts
- Attachment ingestion from providers
- Bulk campaigns
- AI autonomous replies
- Cross-customer group conversations
- Advanced routing, SLAs and team assignment
