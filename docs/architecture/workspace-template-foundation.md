# Workspace Template Foundation

## Decision

BDB OS remains the single core product. Industry templates configure the core product, and individual client workspaces supply business-specific records and branding.

Vanita is the first Beauty & Wellness example workspace and the ongoing test case for extracting reusable capabilities. It is not a separate product, permanent fork, or alternate architecture.

## Product hierarchy

```text
BDB OS core
├── Reusable department modules
├── Industry templates
│   └── Beauty & Wellness
└── Client workspaces
    └── Vanita Beauty and Wellness Spa
```

## Business problem

Features proven in the Vanita test environment currently risk carrying Vanita-specific assumptions into BDB OS. The system needs an explicit boundary between:

1. reusable BDB OS capabilities;
2. department-owned module logic;
3. Beauty & Wellness defaults and terminology;
4. Vanita-specific data and branding.

## Ownership

- **Core workspace and module architecture:** BDB OS platform architecture, reviewed by Nicholas.
- **Workflow and commercial usability:** product ownership, reviewed by Giovanni.
- **Feature extraction, automation and integrations:** Matthew.
- **Vanita records and operational testing:** Vanita test workspace.

## Implemented in this slice

- A central catalogue for current and planned BDB OS modules.
- Explicit ownership, connected records and offline expectations for each module.
- A General Business template.
- A Beauty & Wellness template using Vanita as its example workspace.
- Industry terminology that changes presentation without changing the underlying records.
- Initial reusable inventory status, reorder and valuation rules extracted from the Vanita stock prototype.
- Business Hub module navigation now reads from the shared catalogue rather than maintaining a separate hard-coded list.

## Deliberately not implemented yet

- No change to the `main` branch.
- No Supabase schema change.
- No workspace template selector.
- No Inventory or Sales route exposed before those modules exist.
- No migration of Vanita test data.
- No deletion or restructuring of `projects/vanita-stock`.
- No customer-specific source directory.

## Extraction rule

Every feature moved out of Vanita must be classified before implementation:

| Classification | Destination |
| --- | --- |
| Required by most businesses | BDB OS core |
| Owned by one department | Reusable module |
| Common to Beauty & Wellness | Beauty & Wellness template or extension |
| Unique to Vanita | Vanita workspace data/configuration |

## Acceptance test

A feature is reusable only when:

- it contains no hard-coded Vanita identity;
- the owning department and primary record are explicit;
- customer links exist where relevant;
- business-owned records can be scoped to a workspace;
- industry wording is configuration, not schema;
- offline behaviour is defined;
- it can support a second hypothetical business in the same industry;
- incomplete modules do not create broken navigation.

## Next recommended slice

1. Review this boundary with Giovanni and Nicholas.
2. Add persisted workspace template selection through a reviewed Supabase migration.
3. Design the reusable Inventory entities and movement ledger.
4. Implement an Inventory route using the extracted domain rules.
5. Map Vanita stock fields into the reusable schema with seed/test data only.
6. Connect inventory movements to sales and completed appointments.

## Risks

- Overfitting generic modules to salon terminology.
- Treating the Vanita prototype database as the production schema.
- Duplicating business logic between `projects/vanita-stock` and the BDB OS application.
- Exposing planned modules before routes, permissions and RLS are ready.
- Building cloud-only mutations that undermine the offline-first requirement.
