# BDB OS Motion System V2.1

## Character
Calm, confident, responsive and slightly luxurious. Motion supports business understanding; it does not perform for attention.

## Tokens
- Instant feedback: 110ms
- Button and hover: 160ms
- Tabs and local state: 220ms
- Panels, menus and toasts: 280ms
- Department navigation: 340ms
- Standard easing: `cubic-bezier(.2,.8,.2,1)`
- Emphasised easing: `cubic-bezier(.16,1,.3,1)`

## Rules
1. Use transform and opacity first.
2. Animate the smallest region that changed.
3. Department transitions may use slight directional movement and opacity.
4. Internal tabs use a shorter vertical reveal and a travelling indicator.
5. List changes use short stagger only when it helps scanning.
6. Buttons compress on press; they do not bounce.
7. Success updates settle into their final state rather than flashing.
8. Business Pulse is ambient, slower than task feedback and calmer when work is complete.
9. Offline mode changes rhythm and saturation without hiding status.
10. Reduced motion preserves state feedback while removing spatial animation.

## Performance
No animation dependency was added. Continuous effects are limited to the small Business Pulse and stop effectively in reduced-motion mode.
