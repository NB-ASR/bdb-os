# Client Experience V2.1 — Harsh Audit

## Decision
V2 is structurally strong enough to refine. It should not be redesigned from scratch.

## Business problem
The existing prototype proves the client workspace architecture, but it still feels like a polished prototype in several moments. Feedback, motion, offline status and customisation are not yet governed as coherent systems.

## Audit findings

### Global shell
- Department changes are functional but lack consistent spatial continuity.
- Active navigation feedback appears rather than travelling naturally.
- Quick-create and command search need shared entrance, stagger and press behaviour.
- Review controls need to be clearly separated from the customer product.

### Business Hub
- Business Pulse is distinctive but does not visibly settle as work is completed.
- Action completion needs a clearer state transition.
- Offline status explains the state but does not demonstrate a queue and reconnection.

### Customers
- Customer selection is clear, but internal tab changes are abrupt.
- Notes need optimistic local save feedback and offline queue behaviour.
- Activity updates should enter progressively rather than appear as a block.

### Calendar
- Appointment confirmation should visibly transition from pending to confirmed.
- Filtering needs local list animation rather than a full-page transition.

### Communications
- Selecting a conversation should mark it read.
- AI must pause honestly offline.
- Sending offline should create a visible queued message state.

### Accounts and Banking
- Financial state changes need clear human confirmation and local queued status.
- Reconciliation should visually settle without implying a cloud write when offline.
- External feed refresh must be disabled offline.

### Documents
- Filtering and selection need progressive reflow.
- Upload and share actions need local/offline states.

### Reports
- Range and metric controls should update the chart without theatrical motion.
- Insight must remain decision-oriented, not decorative analytics.

### Team and Settings
- Team access changes need feedback.
- Settings should remain safe client controls, not Founder Admin.
- Customisation belongs in a dedicated Theme Lab rather than scattered controls.

### Mobile and accessibility
- Motion must reduce automatically under `prefers-reduced-motion`.
- Founder review controls must not obscure the bottom navigation.
- Financial rows need mobile reflow rather than horizontal desktop tables.

## Rejected ideas
- No animation library for this prototype. CSS transforms and opacity cover the required behaviour with less weight.
- No decorative video, particles, excessive blur or glassmorphism.
- No client control over navigation, permissions, financial safety or accessibility minimums.

## Acceptance standard
Every major interaction must communicate one of: location, state change, progress, confirmation, connection status or hierarchy. Motion with no such purpose is removed.
