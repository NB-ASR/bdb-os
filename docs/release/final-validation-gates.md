# Final Launch Validation Gates

This file records the checks required on the final head of `qa/launch-readiness-hardening-v1` before the pull request can move out of draft.

## Automated

- TypeScript passes.
- Unit tests pass.
- Static database security contracts pass.
- Canonical migration-history guard passes.
- Vanita source hardening and JavaScript syntax checks pass.
- ESLint passes with no errors or warnings introduced by the launch hardening.
- Next.js production build passes.
- Disposable Supabase migration replay passes.
- pgTAP security and isolation checks pass.
- Public Chromium journeys pass.
- Vercel preview is ready and has no runtime errors.

## Environment-dependent

- Dedicated QA Supabase variables are configured.
- Authenticated owner journeys pass.
- Invitation activation and expiry pass.
- Password change, MFA and suspension denial pass.
- Stripe test billing portal opens for a QA workspace.
- Dedicated Vanita schema revision and conflict function are installed and tested on two devices.

## Founder approval

- Giovanni approves V1 scope and customer-facing claims.
- Matthew approves invoice, finance and Vanita integrity boundaries.
- Niki approves architecture, deployment and rollback readiness.

The draft pull request must not merge into `main` until the relevant gates above are recorded as complete.
