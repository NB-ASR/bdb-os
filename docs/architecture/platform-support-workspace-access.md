# Platform support workspace access

## Decision

Founder Admin can open any trial or active workspace through an audited, short-lived support session.

Support access is separate from the client company switcher. It does not impersonate the Business Owner and does not create a permanent workspace membership.

## Business problem

Platform administrators need to verify workspace provisioning, investigate client issues and review module configuration without obtaining or resetting a client's credentials.

## Ownership

- Department: Platform Administration / Founder Admin
- Primary record: `workspaces`
- Access record: `platform_support_sessions`
- Audit record: `audit_logs`

## Version 1 scope

- Select any trial or active workspace from Founder Admin.
- Require a support reason between 5 and 500 characters.
- Create a 30-minute support session.
- Permit workspace reads only.
- Display a persistent `Founder support · Read only` control.
- Switch directly between available workspaces with a new reason.
- End access and return to Founder Admin.
- Record support-session start and end events.

## Access model

Normal business users continue to use `get_my_linked_workspaces()` and can only switch between explicitly linked companies for which they have active membership.

Founder support uses:

- `platform_support_sessions`
- `private.has_active_support_session(workspace_id)`
- `public.get_my_support_session()`
- `/api/admin/support-session`

The active support session becomes the effective workspace context without adding a row to `workspace_memberships`.

## Security controls

- Only an authenticated platform administrator can create or end a session through the server API.
- Production platform administrators still require MFA through `requirePlatformAdmin()`.
- Development Preview retains its exact branch, environment, Supabase-project and identity guards.
- The browser can read only its own active support session under RLS.
- Operational workspace permissions return `true` only for `view` while support access is active.
- Workspace management, membership administration and general writes remain blocked.
- Sessions expire after 30 minutes and can be ended manually.
- Every start and end is written to `audit_logs`.

## Offline behaviour

Support access is intentionally cloud-dependent. It must not be opened, extended or switched while offline because the current authorisation and expiry must be verified against Supabase.

## Alternatives rejected

### Store one password per workspace

Rejected because it does not scale, exposes client credentials and binds platform operations to individual owner accounts.

### Impersonate the workspace owner

Rejected because actions would appear to come from the client and would weaken accountability.

### Add the Founder as a permanent workspace member

Rejected because it pollutes client team records, seat counts and permissions, and leaves standing access after support work ends.

### Treat every workspace as a Business Group

Rejected because Business Groups represent genuine related companies, not platform support access.

## Risks

- Read-only support still exposes workspace data to authorised platform staff.
- Expired rows remain as an audit record and require normal retention policy management.
- UI controls may remain visible even when a write will be rejected by RLS; the support banner must remain prominent.

## Future implications

A future elevated support mode may allow narrowly scoped writes, but it must be a separate explicit access mode with stronger confirmation, a shorter expiry and additional audit metadata. It must not silently expand the current read-only session.
