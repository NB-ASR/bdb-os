# ADR-003 · Sector Packs and Client Blueprints

## Decision

BDB OS will support sector and client specialisation through configuration, not through separate applications or copied codebases.

Every client workspace resolves three layers:

1. **BDB OS Core** · shared customers, appointments, communications, invoices, payments, documents, activity, permissions and offline behaviour.
2. **Sector Pack** · versioned defaults for terminology, visible departments, workspace emphasis, workflow catalogue, compliance prompts and required record-field definitions.
3. **Client Blueprint** · the selected Sector Pack plus audited client-specific overrides.

Founders edit a draft blueprint in Founder Admin. Only an explicit publish operation updates the immutable published configuration read by the client workspace.

## Business problem

Clients in healthcare, wellness, legal, accounting and other sectors share the same operating records but use different language, priorities, controls and repeatable workflows. A premium implementation should feel purpose-built without forcing BDB OS to maintain a product fork for each industry.

## Ownership

- Product definition and template language: Giovanni
- Automation and integration mapping: Matthew
- schema, runtime resolution, security and release quality: Niki
- publication approval: Founder Admin with MFA and audit logging

## Connected records

Sector Packs do not introduce parallel business records. They configure how the existing customer, appointment, invoice, payment, document, communication and activity records are presented and operated.

## Offline behaviour

The last published blueprint is loaded with the workspace state and becomes part of the local read model. Draft configuration is cloud-only and Founder Admin-only. Offline workspace mutation remains governed by the existing command-queue decision and is not expanded by this feature.

## Publication model

- Draft changes never affect the client workspace.
- Publishing resolves the selected Sector Pack and overrides into one validated JSON blueprint.
- The client reads only the published blueprint.
- Malformed values are removed and missing configuration falls back to General Services.
- Module visibility is an experience decision, not an authorization boundary. Existing feature entitlements and row-level security remain authoritative.

## Alternatives considered

### Separate application per sector

Rejected. It duplicates routes, data access, testing, security fixes and workflow logic. Sector improvements would drift and every bug fix would require multiple releases.

### Fully free-form app builder

Rejected for the first release. It would make support, testing and offline guarantees unbounded. Founders can customise within a governed schema and add new versioned Sector Packs when a repeated need is proven.

### Hard-coded sector switches in components

Rejected. Conditional logic distributed across pages would be difficult to audit, version and roll back.

## Risks

- Configuration can become overly broad and recreate a low-code platform.
- Sector terminology may imply regulatory compliance that BDB OS does not provide.
- Hiding a module may be mistaken for removing access.
- Template changes can affect many clients if packs are edited in place.

## Mitigations

- Version Sector Packs instead of silently changing published client blueprints.
- Keep compliance items as prompts and workflow gates, not legal or professional advice.
- Preserve feature entitlements and RLS as the security boundary.
- Publish a resolved client snapshot so future template versions do not mutate existing clients automatically.
- Require founder review and audit every publication.

## Future implications

The same blueprint can later configure dashboard blocks, onboarding, record-field rendering, workflow policies, provider mappings and bounded AI tools. Those capabilities must continue to use shared BDB OS records and must not create sector-specific storage models without a separate architecture decision.
