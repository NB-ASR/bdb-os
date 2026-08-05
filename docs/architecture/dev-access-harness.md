# Development access harness

Status: Temporary integration infrastructure  
Owner: Platform engineering  
Target branch: `integration/vanita-workspace`

## Business problem

The Vanita workspace merger needs a shared remote preview without connecting experimental code to the BDB OS production database. Supabase development branches are unavailable on the current plan, so the integration preview will temporarily use an approved personal Supabase project.

## Decision

Keep the production authentication architecture intact. On the protected Vercel Preview only, provide a switch between two seeded Supabase identities:

- **Admin** — opens the BDB OS platform control plane.
- **Workspace** — opens one seeded client workspace.

The switch removes the manual login step, but it still creates a real Supabase session. Existing RLS, workspace membership, browser data access and audit foreign keys therefore remain active.

## Fail-closed controls

Development access is enabled only when all of the following are true:

1. `BDB_DEV_ACCESS_ENABLED=true`.
2. The runtime is local development or Vercel Preview, never Vercel Production.
3. The Vercel Git ref matches `BDB_DEV_ACCESS_GIT_REF`.
4. The Supabase project ref parsed from `NEXT_PUBLIC_SUPABASE_URL` matches `BDB_DEV_SUPABASE_REF`.
5. The signed-in identity email matches the configured seeded identity for the selected view.

The preview must also remain protected by Vercel team authentication.

## Required development records

The personal Supabase project must contain:

- One Auth user for the Admin view.
- One Auth user for the Workspace view.
- A profile for the Workspace user.
- One active workspace.
- One active owner membership connecting the Workspace user to that workspace.
- Plan features or workspace overrides needed by the modules under test.

The Admin user does not bypass Supabase authentication. Only the production MFA and `platform_admins` lookup are replaced by the stricter preview branch, project-ref, cookie and email guards.

## Rejected alternatives

- Connecting Vercel Preview directly to production Supabase.
- Disabling RLS in the personal project.
- Exposing the service-role key to browser code.
- Adding `devMode` permission bypasses inside individual modules.
- Replacing the normal production login flow.

## Removal gate before merging to `main`

Before the Vanita integration can merge:

- Remove all `BDB_DEV_*` variables from Vercel.
- Confirm the switch is absent from a production build.
- Restore real founder login and MFA validation.
- Validate a real workspace-owner login.
- Validate workspace membership and feature entitlement enforcement.
- Run authenticated admin and workspace end-to-end journeys.
- Confirm the final preview points to the shared Supabase project only after database migrations are approved.

The development harness may remain in source temporarily because it fails closed, but it must not be enabled or configured in Production.
