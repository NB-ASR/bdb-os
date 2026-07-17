# BDB OS Client Experience V1

Status: Design prototype only  
Branch: `design/client-experience-v1`  
Preview route: `/design-preview`

## Decision

Keep the Founder Admin experience information-dense and create a separate, role-aware client experience using the same product architecture and business records.

This branch does not replace the production workspace. It adds an isolated preview route using static fictional data so Giovanni, Matthew and Niki can review the direction before any migration decision.

## Business problem

The current client shell exposes too many departments and administrative controls at once. That creates unnecessary cognitive load for owners and staff who need to complete ordinary business tasks quickly.

The prototype answers three questions on every screen:

1. Where am I?
2. What needs attention?
3. What should I do next?

## Product ownership

- Giovanni owns workflow clarity, commercial fit and usability for real business teams.
- Matthew owns how AI, automation and integrations appear without taking decisions away from people.
- Niki owns architecture, component boundaries, offline reliability, performance and implementation quality.

## Connected records

The customer remains the centre of the workspace. The preview demonstrates customers connected to:

- appointments
- invoices and balances
- unified communications
- documents
- recent history

No department is presented as an isolated mini-application.

## V1 boundaries

Included in the prototype:

- calm Business Hub
- role-aware navigation
- customer-centred record view
- simplified calendar
- simplified accounts view
- unified inbox concept
- secondary departments under More
- responsive mobile navigation
- subtle transitions
- reduced-motion support
- visible offline behaviour

Not included:

- changes to the live workspace routes
- database writes
- real customer or financial data
- new cloud services
- paid design services
- autonomous AI actions
- deep analytics or advanced automation

## Role behaviour

Owner preview:

- Hub
- Customers
- Calendar
- Accounts
- Communications
- More, including financial and management tools

Staff preview:

- Accounts and owner-only tools disappear completely
- everyday customer, calendar and communication work remains visible
- the interface does not show inaccessible modules as disabled clutter

## Visual principles

The design is inspired by the discipline of Apple interfaces, not by copying Apple assets or styling.

- strong hierarchy
- generous spacing
- predictable interaction
- restrained depth
- subtle motion that preserves context
- large targets
- progressive disclosure
- premium charcoal and dark-gold BDB identity
- minimal visual noise

The design must continue to feel like a Business Operating System rather than a generic SaaS dashboard.

## Motion rules

The prototype uses local CSS transitions only. This avoids introducing a runtime dependency before the direction is approved.

If the team approves the interaction model, Motion for React may be added selectively for shared-layout transitions and complex state changes. Motion must never become decoration for its own sake.

- typical feedback: 140-180 ms
- view transition: about 260 ms
- no continuous decorative animation
- respect `prefers-reduced-motion`
- motion explains hierarchy or spatial change

## Offline-first rules

The preview has no external runtime assets or paid services. Production migration must preserve these constraints:

- application shell and core assets cached locally
- essential records available from local storage or an offline database
- writes queued and clearly marked while offline
- conflict handling defined before broad editing support
- AI and third-party integrations may pause offline
- no CDN-only fonts, icons or scripts
- every sync state uses plain language

The visible status in the prototype listens to the browser online/offline event, but it does not claim that full data synchronisation is implemented by this design branch.

## Architecture

The prototype is isolated under:

- `src/app/design-preview/page.tsx`
- `src/app/design-preview/client-experience-preview.tsx`
- `src/app/design-preview/preview.module.css`

The existing client routes and components are unchanged. The only shared runtime adjustment is marking `/design-preview` as a standalone route so the current production shell does not wrap the prototype.

Static data is deliberate. Connecting the prototype to `BdbProvider` now would blur design review with production migration and create avoidable risk.

## Review checklist

Giovanni:

- Can a normal owner understand the Hub in under ten seconds?
- Are the main actions commercially realistic?
- Does the experience feel premium without becoming theatrical?

Matthew:

- Is AI clearly assistive rather than autonomous?
- Are automation and integrations placed where users naturally expect them?
- Does offline behaviour degrade honestly?

Niki:

- Are role boundaries explicit?
- Can the design be migrated through shared components without duplicating domain logic?
- Are responsive behaviour, accessibility and performance acceptable?
- Does every proposed interaction work without a cloud dependency?

## Migration path after approval

1. Approve or revise the visual and interaction direction.
2. Extract approved tokens and primitives into a BDB client design layer.
3. Define role-to-department visibility centrally.
4. Migrate the Business Hub first behind a feature flag.
5. Test with fictional and staging data.
6. Migrate one department at a time.
7. Preserve the Founder Admin shell.
8. Merge only after usability, accessibility and offline checks pass.

## Risks

### Two separate products

Risk: the admin and client experiences drift into duplicated applications.

Mitigation: share domain logic, permissions, records and low-level primitives. Separate only layouts, navigation density and task presentation.

### Generic component-library appearance

Risk: copied components make BDB OS look like every other dashboard.

Mitigation: BDB-owned tokens, spacing, motion rules and customer-centred composition. Component libraries may supply behaviour, not identity.

### False offline confidence

Risk: an offline badge suggests reliability that has not been engineered.

Mitigation: treat this branch as visual design only and define local persistence, queues and conflict handling separately before production migration.
