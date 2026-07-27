# Supplier document capture and review

## Decision

BDB OS will treat each supplier invoice or credit note as one workspace-owned source document under **Documents → Purchasing**.

The workflow is:

```text
Capture original file
→ private upload
→ structured extraction draft
→ Supplier and Product matching
→ human review
→ approval
→ later Inventory and Accounts posting
```

Approval in this phase does not create stock movements, payables, payments or bank transactions.

## Business problem

Businesses should not repeatedly enter the same supplier document into Documents, Inventory and Accounts. One reviewed source document must support all later departmental postings while preserving the original evidence and review history.

## Ownership

| Responsibility | Owner |
|---|---|
| Original file and document lifecycle | Documents |
| Supplier-document extraction and review | Purchasing |
| Supplier identity and defaults | Suppliers |
| Product identity | Products |
| Supplier-specific product terms | Product–Supplier relationship |
| Stock receipt or reversal | Inventory |
| Payable and balance | Accounts |
| Settlement and reconciliation | Banking |

## Data model

The operational foundation contains:

- `supplier_documents`
- `supplier_document_lines`
- `supplier_document_extraction_runs`
- `supplier_document_command_receipts`

Every record is workspace-scoped. Original files are stored privately in the existing `workspace-documents` bucket under a workspace-prefixed Purchasing path.

## Extraction rules

Extraction is assistive rather than authoritative.

The system retains the structured output, confidence, warnings, model and extraction-run timestamps. Extracted values remain review drafts until a user confirms the Supplier, document type, number, dates, totals and every line.

Product matching follows this order:

1. Supplier SKU through an active Product–Supplier relationship.
2. Product barcode.
3. Internal Product SKU.
4. Manual Product selection.
5. Explicit non-stock expense classification.

The scanner does not silently create Products or Product–Supplier relationships.

## Security and integrity

- Browser clients receive RLS-scoped reads only.
- Upload, extraction and review mutations use trusted server commands.
- Commands are workspace-authorised and idempotent.
- Review updates use optimistic concurrency versions.
- Founder support sessions remain read-only at the database layer.
- File signatures are checked rather than trusting the browser MIME value.
- Files are SHA-256 hashed for duplicate detection.
- Supplier, document type and document number provide a second duplicate guard after review.
- Approved records are locked against further editing in this slice.
- Raw extraction runs and command receipts are service-role-only.

## Offline behaviour

Supported offline:

- select or photograph a supplier document;
- retain the original file in IndexedDB;
- reopen the cached Purchasing register;
- reopen previously cached review drafts;
- edit a review draft;
- queue a `save_review` command;
- deliberately discard local files or review drafts.

Cloud-dependent:

- private file upload;
- AI extraction;
- shared duplicate checks;
- Supplier and Product validation against current shared data;
- approval.

Queued commands preserve stable idempotency keys. A stale shared version stops synchronisation rather than overwriting another user's review.

## Alternatives considered

### Copy the original Vanita scanner directly

Rejected. The prototype sends a complete base64 file through one request, uses old Vanita authentication and has no durable workspace document, extraction-run or posting boundary.

### Let Inventory own supplier invoices

Rejected. Inventory owns stock movements, not original financial evidence. This would duplicate documents when Accounts is connected.

### Automatically post after extraction

Rejected. Extraction confidence is not sufficient authority for stock or financial actions. BDB OS follows the rule that AI assists and humans decide.

### Allow approval offline

Rejected for Version 1. Approval must validate the current shared record, duplicate guards and workspace permissions. Offline review drafts remain useful without pretending that a final shared decision occurred.

## Risks

- Poor scans can produce incomplete or incorrect rows.
- Supplier naming differences may prevent automatic matching.
- Large or complex PDFs may exceed extraction-service constraints.
- Offline review drafts can conflict with a newer cloud version.
- AI extraction has variable cost and requires service availability.

These risks are surfaced through review status, confidence, warnings, explicit matching and conflict rejection.

## Future implications

The approved document will later become the source for two independent commands:

```text
Approved supplier document
├─ Inventory receipt or credit reversal
└─ Accounts payable or supplier credit
```

Those commands must be idempotent and must reference the approved document and its reviewed lines. Neither department may rewrite or replace the original document history.
