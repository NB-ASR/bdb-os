# BDB OS Client Experience V2 Interactive Review

Status: Founder review only  
Branch: `design/client-experience-v2`  
Preview route: `/design-preview`

## Decision

Client Experience V2 is a fully interactive design prototype covering the complete client-facing workspace. It exists so Giovanni, Matthew and Niki can test the product direction before any production migration.

This branch does not replace the production workspace, does not connect to live business records and must not be merged directly into `main`.

## What can be tested

- Business Hub priorities and task completion
- Owner and Staff role differences
- Customer search, filters, tabs, notes and connected records
- Calendar day/week views, appointment drawer and confirmation states
- Unified communications, AI draft insertion and preview message sending
- Accounts filters, invoice drawer, payments and recurring billing concepts
- Banking feeds, reconciliation, matching and payout states
- Documents search, categories, favourites, grid/list views and detail drawer
- Reports controls, metric switching and comparison states
- Team access, role visibility and permission previews
- Settings tabs, integrations, accessibility and offline controls
- Global command palette, quick create, notifications and responsive navigation

## Premium interaction principles

- One primary action per screen
- Secondary actions use progressive disclosure
- Motion confirms state changes rather than decorating them
- Customer, appointment, invoice, document, payment and message relationships remain visible
- Financial and management controls disappear for Staff
- Offline behaviour is described honestly
- Reduced-motion preferences remain supported

## Important limitations

The prototype uses static fictional data and local React state. It demonstrates interaction and product behaviour, but it does not implement:

- Supabase writes
- real bank connections
- real payment processing
- actual messaging
- persistent offline storage
- queued sync conflict resolution
- production permissions
- real file upload

Those belong to the controlled migration after approval.

## Founder review responsibilities

### Giovanni

- Confirm the experience matches real owner and staff workflows.
- Confirm the product feels commercially premium and understandable.
- Review business language and task priority.

### Matthew

- Confirm AI remains assistive and human-controlled.
- Confirm automation and integration concepts appear in the right context.
- Confirm cloud-dependent features degrade honestly when offline.

### Niki

- Confirm the design can be implemented through shared domain logic and components.
- Confirm roles can be centralised and enforced.
- Define persistence, queued writes and sync conflict handling before migration.
- Validate performance, responsive behaviour and accessibility.

## Migration gate

No production migration until all three founders explicitly approve the interactive direction.

After approval:

1. Extract the approved design tokens and reusable client primitives.
2. Centralise role-to-department visibility.
3. Migrate the Business Hub behind a feature flag.
4. Migrate one department at a time.
5. Connect staging data before production records.
6. Implement empty, loading, error and high-volume states.
7. Engineer offline storage, queued writes and conflict resolution.
8. Run accessibility and real-user workflow tests.
9. Keep Founder Admin separate unless reviewed independently.

## Final verdict

Approved as a complete interactive concept for founder review.

Not approved for direct production use, live data connection or merge into `main`.
