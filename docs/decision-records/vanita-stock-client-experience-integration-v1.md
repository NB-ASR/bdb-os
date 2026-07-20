# Decision Record: Vanita Stock Client Experience Integration V1

## Decision

Apply the approved BDB OS client-experience design language to the dedicated Vanita Stock PWA without changing its inventory, document, service, sales, discount, cloud or offline business logic.

Create a combined founder-review branch and expose the existing standalone PWA through a controlled BDB OS review route. Keep the production Vanita deployment and `main` unchanged until founder approval.

## Business problem

Vanita Stock was functionally complete but visually operated as a separate green-and-cream product. Customers should recognise it as a tailored BDB OS workspace while still seeing Vanita Beauty as the business identity.

## Ownership

- Client workflow and commercial fit: Giovanni
- Automation, document extraction and integration boundary: Matthew
- Architecture, reliability, offline behaviour and implementation quality: Niki

## Connected records

The presentation applies to products, inventory quantities, services, supplier invoices, credit notes, sales, discounts, staff assignments and stored documents. The migration does not alter the shape or meaning of those records.

## Implementation

- `projects/vanita-stock/styles.css` is the single presentation layer for the standalone PWA.
- The design uses the BDB charcoal, warm-gold, typography, spacing, surface and interaction system.
- Vanita remains visible as the tenant/workspace identity rather than becoming a competing product brand.
- `/vanita-stock-review` serves the existing project files directly. It does not duplicate them into the root application.
- Review API calls are isolated under `/vanita-stock-review/api`.
- Dedicated `VANITA_SUPABASE_URL` and `VANITA_SUPABASE_ANON_KEY` variables are required before review cloud access can be enabled. The main BDB Supabase credentials are never used as a fallback.
- The PWA service worker is scoped to `/vanita-stock-review/` in the review deployment.

## Alternatives considered

### Copy the Vanita files into `public/`

Rejected. This creates two copies of the same application and guarantees future visual and functional drift.

### Edit Matthew's working branch directly

Rejected. Presentation integration should not destabilise the completed stock implementation or overwrite its development history.

### Force Vanita into the root Next.js component model now

Rejected for Version 1. The PWA already has offline, camera, scanner and local-state behaviour. A full rewrite would add risk without solving a current customer problem.

## Risks

- Global visual changes can expose fixed-height or dense table issues.
- Service workers can cache old presentation assets.
- Reusing the main BDB cloud environment could cross tenant boundaries.
- The standalone production Vanita Vercel project is managed separately from the root BDB project.

## Mitigation

- Replace only the dedicated Vanita presentation stylesheet.
- Preserve all JavaScript business logic.
- Version and scope the review service-worker cache separately.
- Require dedicated Vanita cloud variables.
- Verify desktop, mobile, authentication, tables, modals, sales, document review and offline routes before merge.

## Offline-first implications

The redesigned stylesheet, scripts, manifest and icons remain part of the PWA cache. Core product, inventory, service and sales work continues through local storage when dedicated cloud configuration is absent.

## Version 1 status

Essential. Vanita is a real customer workspace and must demonstrate that BDB OS can preserve one product identity while tailoring workflows to an individual business.

## Approval gate

Do not merge `integration/full-site-client-experience-v1` into `main`, Matthew's Vanita branch or the standalone production deployment until Giovanni, Matthew and Niki approve the combined review.
