# Client Dashboard Composer V1

## Purpose

Allow Founder Admin users to create a sector-specific client workspace from an approved template, customise it for the client, preview the resolved experience, and publish a versioned dashboard without forking the BDB OS codebase.

## Product model

Each client dashboard resolves from:

1. Shared BDB OS core records, permissions and design system.
2. A versioned Sector Pack.
3. An approved dashboard template.
4. Client-specific overrides.
5. One explicitly published dashboard version.

Draft changes remain founder-only. Client users consume only the last published version.

## Founder workflow

1. Select or provision a client workspace.
2. Choose a Sector Pack.
3. Choose a dashboard template.
4. Configure terminology, modules and navigation.
5. Arrange approved dashboard blocks.
6. Configure workflow and KPI defaults.
7. Preview desktop, tablet and mobile layouts.
8. Save as draft.
9. Validate configuration.
10. Publish a versioned dashboard.
11. Roll back to a previous published version if required.

## Approved block catalogue

The composer is schema-driven and does not accept arbitrary HTML or executable code.

Initial blocks:

- Today priorities
- Upcoming appointments
- Unread communications
- Outstanding invoices
- Recent payments
- Customer follow-ups
- Documents requiring review
- Workflow approvals
- Exceptions and failed actions
- Sector-specific KPI summary
- Recent activity

Each block declares:

- stable block type
- owning department
- supported sectors
- required entitlement
- data source contract
- allowed sizes
- configuration schema
- empty state
- offline behaviour
- accessibility label

## Sector templates

Initial templates:

- General Services
- Healthcare Practice
- Wellness Studio
- Legal Practice
- Accounting Firm

Templates define defaults only. Publishing resolves the template and client overrides into an immutable snapshot so later template edits cannot silently change existing clients.

## Client override boundaries

Founders may configure:

- terminology
- visible modules
- navigation order
- dashboard block selection
- dashboard block order and supported size
- workflow defaults
- KPI emphasis
- compliance prompts
- approved branding tokens

Founders may not configure:

- arbitrary scripts
- arbitrary database queries
- custom RLS rules
- permission bypasses
- unapproved financial automation
- custom HTML
- destructive workflow behaviour

## Runtime contract

The client shell loads only the last published dashboard snapshot for its workspace. Missing or malformed configuration falls back to the General Services dashboard. Existing entitlements, permissions and RLS remain authoritative even when a block is present in the published snapshot.

## Offline contract

The last published dashboard snapshot is cached with the workspace read model. Founder editing and publishing require cloud connectivity. Client blocks must declare whether they are read-only offline or unavailable offline.

## Required persistence

- dashboard_templates
- workspace_dashboard_drafts
- workspace_dashboard_versions
- workspace_dashboard_publications
- dashboard_publication_audit

All workspace-scoped records require RLS and same-workspace foreign-key enforcement.

## Acceptance gates

- Draft changes never affect the client workspace.
- Publishing is explicit, audited and atomic.
- Rollback restores a previous complete snapshot.
- Invalid layouts cannot hide every required department.
- Blocks cannot bypass entitlements or permissions.
- Desktop, tablet and mobile previews match the published runtime.
- General Services fallback works for unconfigured workspaces.
- Migration replay, pgTAP, TypeScript, ESLint, production build and Chromium journeys pass.
- Authenticated Founder and client acceptance is completed in dedicated QA before merge.
