# Customer Engine V1 Closure

Status: In progress
Branch: `customer-engine-v1-closure`
Base: `e806c3a5b0dcbe95c9ceeadc1ea8b0c01e9e1235`

## Agreed four-pass scope

1. Pass 1 — Canonical Customer Foundation
2. Pass 2 — Scale & Offline Reliability
3. Pass 3 — Customer 360 & Cross-Engine Integrity
4. Pass 4 — Scale Torture, Security & Closure

## Pass 1 — Canonical Customer Foundation

Goal: establish one unambiguous source of truth for Customer identity and Customer-owned context before scale/offline work.

Included:
- `customers` remains the canonical Customer identity record.
- The append-only `customer_notes` ledger is the canonical operational Customer notes/history system.
- Existing legacy `customers.notes` content must be preserved and clearly treated as legacy/imported context; it must not remain a second mutable operational notes system.
- VAT/legal identity belongs to the Customer master record and must be available through normal Customer create/edit/profile flows.
- `document_links` is the canonical relationship model for Customer-linked general Documents; any retained direct `documents.customer_id` compatibility must not create a second independent source of truth.
- Archive/restore semantics must be explicit: archived Customers retain history but cannot be selected for new operational work until restored.
- Vanita provenance/import receipts remain immutable and preserved.

Exit condition:
- One clear source of truth exists for Customer identity, notes, VAT/legal identity, and general-document relationships.
- Existing Customer history/provenance is preserved.
- Foundation contracts and tests pass before Pass 2 begins.

## Guardrails

- No Customer CRM expansion in V1.
- No paint-job work in closure passes.
- No Accounts Engine financial-rule changes.
- No unrelated module refactors.
- Do not merge to `main` until all four Customer passes and the final full validation are complete.
