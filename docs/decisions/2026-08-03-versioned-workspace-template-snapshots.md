# Decision: provision workspaces from versioned template snapshots

**Date:** 2026-08-03

## Decision

Founder Admin will provision every new workspace from one active, versioned workspace template.

The template is copied into the workspace at provisioning time. Existing workspaces do not inherit later template edits automatically.

Both email-invitation provisioning and manual pilot-account provisioning must call the same trusted template-application command.

## Reason

The previous implementation duplicated plan, feature, Settings, Theme and permission defaults across multiple application routes. Manager and Employee permissions were also global code presets.

A snapshot model provides:

- one reviewable provisioning contract;
- reproducible client setup;
- explicit workspace provenance;
- stable access behaviour after onboarding;
- safe template evolution;
- separation between commercial plans, templates and client-specific overrides.

## Alternatives considered

### Continue manual plan and module selection

Rejected. It leaves Founder onboarding inconsistent and duplicates business rules across normal and manual provisioning.

### Make workspaces inherit templates live

Rejected. A template edit could silently change client entitlements, currency, VAT, invoice defaults, appearance or employee access. That is too dangerous for an operating system containing financial and operational records.

### Use commercial plans as templates

Rejected. Plans describe commercial entitlements. They do not adequately own workspace settings, appearance or access presets, and plan edits should not retroactively mutate client configuration.

### Clone an existing workspace

Rejected. A workspace contains operational, security and commercial records that must not be copied as provisioning defaults.

## Risks

- Template versions may diverge from older clients.
- Founders must understand the distinction between plan defaults, template snapshots and client overrides.
- Future template migrations require a dedicated reviewed workflow.
- Legacy workspaces have no authentic template provenance.

## Mitigations

- Display template ID/version on each provisioned client.
- Show workspace-usage counts in the template editor.
- Keep template changes audited.
- Keep existing workspaces on legacy-compatible permission presets without assigning a false template ID.
- Require complete module and permission matrices before a template can be saved.
- Keep the application command service-role-only and platform-admin validated.

## Future implications

A future bulk template upgrade must be a separate command with client selection, before/after preview, impact analysis, stable idempotency, audit evidence and rollback planning.

No such propagation is part of Version 1.
