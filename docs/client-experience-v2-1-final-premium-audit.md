# BDB OS Client Experience V2.1 — Final Premium Audit

## Decision

The V2.1 direction is strong enough for Giovanni and Matthew to review after this refinement pass. It remains a founder-review prototype, not production-ready software.

## Changes made

### Typography and readability

- Use the app's loaded DM Sans body font and Manrope display font instead of requesting Inter and risking fallback rendering.
- Raise the preview base size from 16.5px to 17.5px on desktop and 17px on mobile.
- Establish readable minimums for navigation, metadata, tables, forms, status labels, tabs and secondary copy.
- Increase line-height and muted-text contrast without weakening hierarchy.
- Increase important control heights to a practical 44px minimum.

### BDB Signal Orbit

The Business Pulse has been refined into a potential BDB signature element:

- A functional completion arc shows daily progress.
- Three milestone satellites represent the three priority actions.
- The centre retains the live remaining-action count.
- The visual becomes calmer and green when the daily priorities are complete.
- Offline mode changes the state colour and pauses ambient movement.
- The asymmetric fluid halo gives the element a distinctive identity without becoming decorative navigation.
- Reduced-motion preferences remove non-essential orbit and fluid animation.

### Interaction and layout

- Department transitions are slower and calmer while remaining below a disruptive duration.
- Local tab transitions remain quicker than full workspace transitions.
- Collapsed navigation icons, active markers, collapse control and preview badge are optically centred.
- List rows, forms, empty states, tables and feedback messages receive clearer spacing and readable text.
- Card separation is slightly stronger to reduce the soft or blurred appearance without adding visual noise.

## Harsh review findings

### Strong

- Clear customer-centred architecture.
- Owner and Staff separation reduces permission clutter.
- Theme Lab is governed by semantic tokens rather than random page colours.
- Offline behaviour is represented honestly.
- The Hub is focused on useful daily work.
- Motion remains purposeful and respects reduced-motion settings.

### Still requires founder judgement

- Whether the BDB Signal Orbit is distinctive enough to become a repeated brand motif.
- Whether the larger supporting text feels comfortably readable without making information-heavy pages too loose.
- Whether the Theme Lab should remain a full department or move inside Settings for the final product.
- Whether financial pages need denser owner-only modes for high-volume businesses.

### Not production-ready

- Real Supabase persistence and server-side permissions.
- Indexed offline storage, retries and conflict resolution.
- Real banking, Stripe and document operations.
- Formal accessibility testing at 200% zoom and with assistive technology.
- Real-user testing on low-powered laptops and mobile devices.
- Consolidation of preview refinement layers into the production design system.

## Safety boundary

All changes remain isolated on `design/client-experience-v2-1`. No change has been made to `main`, production, Founder Admin, Supabase schemas, Stripe configuration or live customer data.
