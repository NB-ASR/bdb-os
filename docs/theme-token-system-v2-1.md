# BDB OS Theme Token System V2.1

## Purpose
Allow approved client identity changes without turning BDB OS into an ungoverned white-label product.

## Semantic tokens
- Background
- Surface
- Raised surface
- Primary text
- Muted text
- Primary accent
- Supporting accent
- Border
- Success
- Warning
- Danger
- Focus
- Shadow depth
- Radius
- Text scale
- Density
- Typography family
- Motion preference
- Contrast preference

## Presets
- BDB Signature
- Midnight Executive
- Stone & Copper
- Clean Professional
- Client Custom

## Client configurable
Approved accents, workspace identity, appearance, typography from an approved set, text size, density, reduced motion and contrast.

## BDB controlled
Navigation, information hierarchy, permissions, accessibility minimums, customer-centred records, financial safety, offline status and sync communication.

## Persistence
The preview stores the selected theme in browser local storage. This proves offline persistence of preferences only; it does not write to production workspace records.

## Accessibility gate
Theme Lab calculates text/background contrast and warns below 4.5:1. Production implementation must enforce the gate server-side or in validated workspace settings.
