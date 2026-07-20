# Decision Record: Production Client Experience Design System V1

## Decision

Extract the approved Client Experience V2.1 visual language into a shared production design-system layer loaded by the root application layout.

The integration branch starts from the latest `main` and does not merge the experimental V2.1 preview branch.

## Business problem

New public, authentication and workspace pages were being added with correct functionality but inconsistent visual treatment. Customers should experience one coherent BDB OS product from discovery and secure access through daily business operations.

## Department ownership

- Product and commercial language: Giovanni
- Architecture, implementation and reliability: Niki
- Automation and integration boundaries: Matthew

## Connected records

The design system affects presentation only. It does not change customer records, invoices, appointments, documents, communications, banking records, permissions or authentication logic.

## Implementation

- `src/app/bdb-design-system.css` provides semantic production tokens and shared component styling.
- `src/app/layout.tsx` loads the design system after the existing global stylesheet.
- Supabase invitation and magic-link templates use a separate email-safe visual specification.
- Founder Admin shares typography, colour and quality standards while retaining a distinct control-plane layout.

## Alternatives considered

### Merge the V2.1 preview branch into production

Rejected. The preview contains experimental route-specific CSS layers, fictional state and founder-review controls. Merging it would couple production architecture to prototype history.

### Copy styles into each new page

Rejected. This would create duplicate logic and visual drift.

### Leave production styling unchanged

Rejected. The website, authentication and workspace would feel like separate products.

## Risks

- Global CSS can unintentionally affect old or rarely visited screens.
- Increased spacing and text size can expose fixed-height component bugs.
- Email clients render modern CSS inconsistently.

## Mitigation

- Work only on `integration/client-experience-design-system-v1`.
- Keep the layer semantic and class-based rather than importing preview components.
- Preserve mobile breakpoints and reduced-motion behaviour.
- Use inline, table-based styling for authentication emails.
- Require Vercel build verification and founder visual review before merge.

## Offline-first implications

The design-system change is local presentation code and remains available offline with the application shell. It does not introduce new cloud dependencies. Authentication callbacks and email delivery remain cloud-dependent by necessity.

## Version 1 status

Essential. A coherent design system reduces future duplication and ensures new V1 departments inherit BDB OS identity by default.

## Approval gate

Do not merge into `main` until Giovanni, Matthew and Niki approve the integration preview and migration scope.
