# ADR: Unified Communications threads and recording boundary

## Decision made

BDB OS Communications will own authoritative conversation threads and append-only communication message records.

Version 1 records inbound and outbound communication activity but does not send through or claim delivery by an external provider.

Every message belongs to an exact thread, Customer and channel. Legacy messages receive one thread each rather than being grouped by subject.

## Reason

The existing flat browser-store model cannot preserve conversation identity, direction, safe retries, human-controlled AI draft state or consistent cross-department history.

Thread identity and trusted commands are required before provider integrations can be added safely.

## Alternatives considered

### Continue using flat `messages`

Rejected. It preserves ambiguity and direct browser mutation.

### Group legacy records by Customer, channel and subject

Rejected. Free-text subject similarity is not proof that records belong to one conversation.

### Add provider integrations now

Deferred. Provider OAuth, webhooks, delivery receipts and failure handling would expand V1 before the internal record model is stable.

### Store Customer contact snapshots inside Communications

Rejected for V1. Customers remains authoritative; Communications references the Customer.

## Risks

- Users may interpret an outbound record as externally delivered. The UI must consistently state that V1 records communication only.
- Users without Customer access may see restricted Customer identity details. APIs must respect Customer permission when returning labels.
- Offline replay could duplicate records without stable command identities. Command receipts are mandatory.
- Thread closure could hide unfinished work if automatically applied. Closure remains a deliberate human command.

## Future implications

External provider connectors must map provider conversations and messages onto the existing thread and message identities rather than creating parallel inbox tables.

Delivery state, provider IDs and attachments can be added later without changing Communications ownership.
