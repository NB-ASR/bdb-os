# Platform support workspace access

## Decision

Founder Admin can open any trial or active workspace through an audited, short-lived support session.

Support access is separate from the client company switcher. It does not impersonate the Business Owner and does not create a permanent workspace membership.

Two explicit access modes exist:

- `read_only` — the normal production support mode.
- `test_write` — a temporary full-access mode issued only by the guarded Vanita integration-preview harness.

## Business problem

Platform administrators need to verify workspace provisioning, investigate client issues and review module configuration without obtaining or resetting a client's credentials.

During the Vanita integration phase, the Founders must also execute complete operational workflows against disposable integration data. A read-only preview cannot validate Purchasing approval, Product creation, Inventory posting, Sales completion, Team controls or other mutations.

## Ownership

- Department: Platform Administration / Founder Admin
- Primary record: `workspaces`
- Access record: `platform_support_sessions`
- Audit record: `audit_logs`

## Version 1 production scope

- Select any trial or active workspace from Founder Admin.
- Require a support reason between 5 and 500 characters.
- Create a 30-minute read-only support session.
- Permit workspace reads only.
- Display a persistent `Founder support · Read only` control.
- Switch directly between available workspaces with a new reason.
- End access and return to Founder Admin.
- Record support-session start and end events.

## Temporary integration-testing scope

When the existing development-access harness passes every environment, branch, Supabase-project and identity check:

- Founder Admin creates a 20-minute `test_write` session.
- The workspace banner reads `Founder testing · Full access`.
- All active product features are visible in navigation.
- Founder testing receives owner-equivalent UI controls without creating an owner membership.
- Browser RLS writes and trusted module commands recognise the explicit `test_write` session.
- Products, Suppliers, Product–Supplier links, Purchasing, Inventory, Services, Sales and Team Management can be exercised.
- Actions affect the integration database and retain the Founder user as actor.

This mode must not be enabled on Vercel Production, `main`, or a Supabase project other than the approved integration project.

## Access model

Normal business users continue to use `get_my_linked_workspaces()` and can only switch between explicitly linked companies for which they have active membership.

Founder support uses:

- `platform_support_sessions`
- `private.has_active_support_session(workspace_id)`
- `private.has_test_write_support_session(workspace_id)`
- `private.actor_has_workspace_permission(...)`
- `public.get_my_support_session()`
- `/api/admin/support-session`

The active support session becomes the effective workspace context without adding a row to `workspace_memberships`.

## Security controls

- Only an authenticated platform administrator can create or end a session through the server API.
- Production platform administrators still require MFA through `requirePlatformAdmin()`.
- Production and unapproved environments always issue `read_only`.
- `test_write` is selected server-side; the browser cannot request or promote its own access mode.
- The development harness requires the exact preview environment, Git branch, Supabase project and seeded Admin identity.
- The browser can read only its own active support session under RLS.
- Read-only support permits `view` and rejects all mutations even when the Founder also has a normal membership.
- Test-write support is explicit, shorter-lived and audited.
- Sessions can be ended manually.
- Every start and end is written to `audit_logs`; module actions retain their normal Activity and command receipts.

## Offline behaviour

Support access is intentionally cloud-dependent. It must not be opened, extended or switched while offline because the current authorisation and expiry must be verified against Supabase.

Test-write commands retain each module's existing offline rules. High-impact cross-record operations such as Purchasing approval and Inventory posting still require online validation.

## Alternatives rejected

### Remove the support write guard globally

Rejected because it would silently turn production support into standing operational access.

### Store one password per workspace

Rejected because it does not scale, exposes client credentials and binds platform operations to individual owner accounts.

### Impersonate the workspace owner

Rejected because actions would appear to come from the client and would weaken accountability.

### Add the Founder as a permanent workspace member

Rejected because it pollutes client team records, seat counts and permissions, and leaves standing access after support work ends.

### Treat every workspace as a Business Group

Rejected because Business Groups represent genuine related companies, not platform support access.

## Risks

- Full-access testing can alter or delete integration records through legitimate product workflows.
- A defect in the environment gate could widen access; the server therefore fails back to `read_only` whenever any check fails.
- Expired rows remain as an audit record and require normal retention policy management.
- Test data must remain isolated from production and must not be treated as authoritative client data.

## Removal gate

Before the integration branch can merge to `main`:

- Confirm Production still issues only `read_only` sessions.
- Remove or disable all `BDB_DEV_*` Vercel variables.
- Confirm `test_write` cannot be issued on Production or another branch.
- Complete authenticated owner acceptance testing.
- Decide whether the guarded source code remains dormant or is removed entirely.

## Future implications

Any future production elevated-support capability must be designed as a separate, narrowly scoped approval workflow. It must not reuse this broad integration-testing permission set without stronger confirmation, customer authorisation and additional audit controls.
