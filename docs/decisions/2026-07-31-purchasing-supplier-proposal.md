# Purchasing Supplier proposal on document approval

## Decision

Supplier-document extraction may propose a Supplier from the printed document name. The proposal is not a permanent Supplier record until a user approves the document.

During review:

- one conservative normalized exact match preselects the existing active Product Supplier;
- no exact match preselects `Create new Supplier · <extracted name>`;
- several exact matches require the user to select the correct Supplier explicitly.

During online approval, the trusted command revalidates the proposal. It reuses a single exact match or creates one active Product Supplier atomically before approving the document. The Supplier uses the document currency and receives a unique generated code. Product–Supplier relationships continue to be created by the existing supplier-document approval command.

## Business problem

The migrated BDB OS Purchasing workflow blocked new supplier invoices even when extraction had correctly read the Supplier name. Users had to leave the document, create the Supplier manually, reopen the document and repeat review. This broke the original Vanita workflow and prevented the approved document from reaching Inventory posting.

## Ownership

- Purchasing owns the extracted proposal and document review.
- Suppliers owns the permanent Supplier identity.
- Inventory owns the later explicit stock-receipt movement.
- Accounts Payable remains separate and is not created by this decision.

## Alternatives considered

### Create the Supplier immediately after extraction

Rejected. Extraction is an AI draft and must not silently create permanent business records.

### Require manual Supplier creation on a separate screen

Rejected. It adds navigation and repeated data entry to a core V1 workflow.

### Fuzzy-match and silently select the nearest Supplier

Rejected. Supplier identity errors can contaminate Product terms, Inventory source history and later payables. V1 uses conservative normalized exact matching only.

## Offline boundary

The proposal can be cached with the review draft. Approval and Supplier creation remain online-only because the command must revalidate the shared Supplier catalogue and document version.

## Risks

- Existing duplicate Supplier names produce an explicit ambiguity error.
- Extracted spelling errors may create a Supplier with the printed spelling after user approval.
- The generated Supplier contains only identity, type, currency and source notes; contact and payment details remain editable in the Supplier directory.

## Future implications

Supplier aliases, VAT-number matching and reviewed merge suggestions can be added later without changing the approval boundary. No fuzzy automatic merge should be introduced without an explicit duplicate-resolution workflow.
