# Customer + Catalogue V1 Operational Acceptance Checklist

This checklist is part of PR #65 and must be complete on the exact final candidate before the repair may merge.

## Customers

| Visible action | Expected customer outcome | Automated proof | Acceptance |
| --- | --- | --- | --- |
| Add Customer | Creates one canonical Customer and opens the Customer profile | `authenticated-core.spec.ts` | Required |
| Edit Customer | Saves through canonical Customer command with optimistic versioning | existing Customer command/closure tests | Required |
| Archive / Restore | Changes lifecycle without deleting history | existing Customer command/closure tests | Required |
| Search / filters | Server-bounded register returns matching Customer rows | Customer Pass 4 scale + page UI | Required |
| Load next 100 | Keyset continuation without replacing/duplicating the working set | Customer Pass 4 scale + page UI | Required |
| Import Customers | Browser accepts CSV, previews rows, requires confirmation, creates canonical Customers | `authenticated-core.spec.ts` + CSV unit tests | Required |
| Customer import Template | Downloads a usable `.csv` template | `authenticated-core.spec.ts` | Required |
| Legacy Vanita JSON | Remains separately labelled and only accepts legacy JSON snapshot format | Customer static/database import contracts | Required |
| Offline create/edit/archive/restore | Queues safely with stable retry identity | Customer Pass 2/Pass 4 queue tests | Required |

## Products

| Visible action | Expected customer outcome | Automated proof | Acceptance |
| --- | --- | --- | --- |
| Add Product | Creates one canonical Product definition | Catalogue Pass 1 + page contracts | Required |
| Edit Product | Updates with optimistic concurrency | Catalogue Pass 1 | Required |
| Archive / Restore | Preserves historical identity | Catalogue Pass 1 + closure test | Required |
| Search / filters | Bounded server search and lifecycle/purpose filters | Catalogue Pass 3 scale/query-plan | Required |
| Load more | Keyset continuation | Catalogue Pass 3 scale/query-plan + page UI | Required |
| Import Products | Browser accepts CSV, previews rows, requires confirmation, creates canonical Products | `authenticated-core.spec.ts` + CSV unit tests | Required |
| Product import Template | Downloads a usable `.csv` template | `authenticated-core.spec.ts` | Required |
| Barcode value entry | Manual barcode can be entered and validated | Product command/uniqueness tests | Required |
| Camera Scan | Deferred; not presented as a usable V1 action | authenticated acceptance asserts no visible Scan action | Required |
| Direct Supplier selector | Deferred from Product form; Supplier Terms remains the owning workflow | customer-visible form hides old disabled placeholder | Required |
| Offline Product changes | Queue and replay safely | Catalogue Pass 2 | Required |

Product CSV import does **not** import stock quantity. Inventory remains the stock source of truth.

## Services

| Visible action | Expected customer outcome | Automated proof | Acceptance |
| --- | --- | --- | --- |
| Add Service | Creates one canonical Service | Catalogue Pass 1 + Service contracts | Required |
| Edit Service | Updates with optimistic concurrency | Catalogue Pass 1 | Required |
| Archive / Restore | Preserves appointment/Sales history | Catalogue Pass 1 + closure test | Required |
| Search / filters | Bounded server search and booking/lifecycle filters | Catalogue Pass 3 scale/query-plan | Required |
| Load more | Keyset continuation | Catalogue Pass 3 scale/query-plan + page UI | Required |
| Import Services | Browser accepts CSV, previews rows, requires confirmation, creates canonical Services | `authenticated-core.spec.ts` + CSV unit tests | Required |
| Service import Template | Downloads a usable `.csv` template | `authenticated-core.spec.ts` | Required |
| Offline Service changes | Queue and replay safely | Catalogue Pass 2 | Required |

## Exact-candidate release gates

The repair remains incomplete until the exact final SHA has all of these:

- BDB OS V1 Validation — green.
- Inventory Test Diagnostics — green.
- BDB OS V1 Customer Operational Acceptance — green against disposable local Supabase/auth using exact PR code.
- Both Vercel Preview checks — READY/success on the same SHA.
- No Production migration is required by this repair unless later code introduces schema changes.

## Production rule

After merge, verify `main` validation and Vercel Production before saying the operational repair is live. Do not label the repaired engines customer-ready on Production merely because the PR merged.
