# Admin workspace-template integration

## Business problem

Founder provisioning previously assembled each client workspace manually from a plan, a module checklist and route-level hard-coded defaults. The normal email-invitation path and the manual pilot-account path duplicated configuration logic. Manager and Employee access also depended on global code presets rather than a workspace-owned provisioning record.

That made onboarding inconsistent, difficult to audit and unsafe to evolve. A new client could receive different modules, settings, appearance or access rules depending on which provisioning screen was used or which code version happened to run.

## Ownership

Founder Admin owns workspace templates and the provisioning decision.

A workspace template owns only the starting configuration for a new workspace:

- commercial starting plan;
- exact enabled-module matrix;
- business defaults such as currency, invoice prefix, VAT rate and timezone;
- appearance defaults;
- workspace-level Manager, Employee and Custom access presets.

The template does not own operational records. Customers, Appointments, Sales, Accounts, Banking, Communications, Documents, Purchasing, Inventory and other departments remain authoritative for their own data.

Business Owners continue to own day-to-day team membership and member-specific permission exceptions after provisioning. Founder Admin may still create explicit client feature overrides or change the commercial plan, but those changes are recorded against the client workspace rather than mutating the source template.

## Version 1 decision

Templates are versioned snapshots, not live inheritance.

When a Founder provisions a workspace:

1. the workspace is created without operational configuration;
2. one active workspace template is selected;
3. the trusted `apply_workspace_template` command copies the template plan, module matrix, settings, appearance and access presets;
4. the workspace records the selected template ID and version;
5. the first Owner membership is created through the selected activation method;
6. the provisioning decision is audited.

Editing a template increments its version. Existing workspaces do not follow later template changes automatically.

This prevents a template edit from silently changing client entitlements, invoices, currency, VAT, appearance or employee access. A future bulk-template migration would require a separate reviewed command, impact preview, client selection, idempotency and rollback plan.

## Data model

### `workspace_templates`

Stores Founder-managed template identity, commercial plan, version, active/default state and JSON configuration defaults.

### `workspace_template_features`

Stores one explicit enabled/disabled row for every active feature. The template does not rely on future plan changes after provisioning.

### `workspace_template_permissions`

Stores complete Manager, Employee and Custom action matrices for every active feature.

### `workspace_access_profile_permissions`

Stores the permission presets copied into an individual workspace. These rows are the workspace-level default used when a member does not have an explicit `workspace_member_permissions` row.

### Workspace provenance

`workspaces.workspace_template_id` and `workspaces.workspace_template_version` record the template snapshot used at provisioning. Legacy or deliberately custom workspaces may retain null provenance.

## Permission resolution

`private.actor_has_workspace_permission` resolves permissions in this order:

1. guarded Founder test-write support;
2. normal Founder support denial;
3. workspace feature entitlement;
4. active workspace membership;
5. Owner full access;
6. explicit member-level permission;
7. workspace access-profile preset;
8. legacy Manager or Employee fallback for pre-template compatibility;
9. deny.

The database remains authoritative. Menu visibility or Team Management presentation is not treated as access control.

## Provisioning paths

Both supported Founder paths use the same template command:

- email invitation provisioning through `/api/admin`;
- manual pilot-account provisioning through `/api/admin/manual-workspace`.

Neither path independently inserts Settings, Theme or feature matrices. This removes duplicate provisioning logic.

## Founder Admin workflow

The MFA-protected control plane provides:

- template creation and editing;
- active and default template controls;
- starting-plan selection;
- complete module matrix editing;
- business and appearance defaults;
- Manager and Employee access preset editing;
- template version and workspace-usage visibility;
- template selection during normal and manual provisioning;
- client template provenance in the workspace detail view.

Custom access defaults are copied as an explicit zero-access matrix unless a Founder deliberately changes the template contract in a future reviewed version.

## Security boundary

Template tables use RLS and expose no browser policies or table privileges to anonymous or authenticated roles.

`save_workspace_template` and `apply_workspace_template` are service-role-only functions. They independently verify the active platform-admin actor. The service role remains server-side in authenticated Founder routes.

Founder Admin remains cloud-dependent and MFA-protected. No offline mutation queue is created for platform provisioning because current authentication, plan state, feature definitions and tenant isolation must be checked online.

## Audit behaviour

The following actions create audit evidence:

- template creation;
- template version update;
- template application to a workspace;
- normal workspace provisioning;
- manual workspace provisioning;
- later client-specific feature, plan or status changes.

Audit metadata records template ID, code and version where applicable.

## Existing workspaces

Existing integration workspaces receive workspace-level Manager, Employee and Custom permission rows matching the prior global behaviour. They are not marked as having been provisioned from a template.

This preserves compatibility without fabricating provenance.

## Offline behaviour

Founder template management and workspace provisioning are online-only.

The resulting client workspace configuration participates in the existing offline behaviour of each operational department. Full offline completion remains the next integration sequence item and will evaluate every Version 1 department together.

## Scope changes

The old Vanita historical-data migration is removed from the remaining Version 1 integration sequence because Vanita was a test environment rather than a production source requiring cutover.

The remaining sequence after this integration is:

1. full offline completion;
2. end-to-end authenticated acceptance;
3. production cutover.

## Deferred

- automatic propagation of later template versions;
- bulk migration of existing clients to a newer template;
- industry-specific template marketplaces;
- customer self-selection of templates;
- offline Founder provisioning;
- AI-generated permission matrices;
- cloning authentication, billing or membership control-plane records;
- production cutover before final authenticated acceptance.
