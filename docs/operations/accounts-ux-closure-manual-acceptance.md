# Accounts UX Closure — Manual Acceptance

Use the exact candidate deployment SHA and an isolated test workspace with an Owner/Manager account. Do not create test financial documents in Production.

## 1. Department navigation

1. Open **Accounts** from the BDB navigation.
2. Confirm the Overview heading is **Financial control without the clutter**.
3. Open **Sales**, **Payments**, **Customer Balances** and **Supplier Payables** from Accounts.
4. Open **Sales → Document setup** and confirm the existing identity/defaults load.
5. Use browser Back from each workspace.
6. Refresh each route and open each route directly in a new tab.

Expected:

- Accounts remains visually coherent and restrained.
- No action opens `/accounts/operations`.
- No former combined Accounts menu/workbench appears.
- There are no redirect loops, broken deep links or cross-workspace data.

## 2. Sales registers

1. Open **Sales → Invoices**.
2. Search by Invoice number, Customer and Sales Order reference.
3. Exercise date, status, payment and credit filters.
4. Move Next then Back when more than 50 rows exist.
5. Repeat search/filter/pagination checks in **Credit Notes** and **Delivery Notes**.

Expected:

- Invoice pages contain at most 50 rows and maintain stable order.
- Search/filtering is server-side; a full financial history is not loaded into the browser.
- Credit Note and Delivery Note View/PDF actions render the selected immutable document.

## 3. New Document journey

1. Open **Sales → New document**.
2. Confirm the choices are **Invoice**, **Credit Note** and **Delivery Note**.
3. Open and return from each composer.

Expected:

- Each choice has a dedicated full-page Accounts composer.
- Back/Cancel returns to the new Accounts experience.
- No legacy workbench is visible.

## 4. Invoice composer

1. Choose a canonical Customer.
2. Search the Product/Service catalogue and add lines.
3. Confirm only Quantity and Discount % are editable.
4. Confirm catalogue Price and VAT are read-only.
5. Confirm a Product or mixed Invoice requires a Sales Order reference.
6. Confirm a service-only Invoice does not require that reference.
7. Issue a test Invoice, then refresh its detail URL.

Expected:

- The server issues one permanent `INV…` document through the existing command path.
- No manual financial line, free-form VAT, draft step or casual paid action appears.
- Customer-facing description and internal Notes remain distinct.

## 5. Invoice detail

1. Open an Invoice from the register.
2. Compare **Original Invoice**, **Credit Notes**, **Payments** and **Remaining balance**.
3. Open **View**, **Print** and **PDF**; open **Email** when the Customer has an email address.
4. Append an internal Note, refresh, and confirm the Note remains.
5. Open linked Credit Notes and Payments.
6. Start **Credit Note** from Invoice Detail, then cancel/back.

Expected:

- The original total and rendered Invoice never change because of later Credits or Payments.
- Live connected state is visually separate.
- Notes append; existing Notes cannot be silently edited.
- Credit Note creation is pre-linked to the selected Invoice.

Regression fixture: historical INV002 must remain €217.12 while its live balance reflects historical CN001 separately.

## 6. Credit Note rules

1. Enter an exact issued Invoice number or enter from Invoice Detail.
2. Inspect full cancellation and quantity-reduction modes.
3. Attempt to exceed remaining source-line quantity.
4. Confirm price, Discount and VAT are inherited and not editable.
5. Issue a test partial Credit Note using a genuine quantity.

Expected:

- No standalone or arbitrary-money Credit Note is possible.
- Full cancellation reverses remaining uncredited quantities.
- Partial credit accepts genuine Product/Service quantity only.
- The original Invoice remains immutable.

## 7. Delivery Notes

1. Create a standalone test Delivery Note.
2. Create one linked to an issued Invoice or completed Sale.
3. Open View/PDF from the Delivery Note register.

Expected:

- Each issued Delivery Note receives permanent `DN…` numbering and remains immutable.
- Fulfilment does not alter Customer financial balances.
- Historical branding rendering is preserved.

## 8. Payments

1. Open **Accounts → Payments**.
2. Search and filter by Customer, method, status and received date.
3. Confirm Allocated and Unallocated amounts are separate.
4. Choose **Record Payment**, select a Customer, enter amount/method/date/reference/Notes and submit.
5. Return to the register and find the new Payment.

Expected:

- Payment creation never opens the legacy workbench.
- The existing Payment command posts one separate Payment record.
- A new Payment begins unallocated; it does not directly rewrite or mark an Invoice paid.
- No Banking transaction or reconciliation evidence is invented.

## 9. Offline and conflict behaviour

1. Load the composer online, then disconnect.
2. Create a test document or Payment and confirm **Pending sync**.
3. Reconnect and confirm one permanent number/record is assigned.
4. Exercise a safe test conflict if available.

Expected:

- Stable command identity prevents duplicates.
- Commands replay in order and stop at the first conflict.
- Later queued work remains intact for review.
- Browser storage contains working/queued data, not full financial history.

## 10. Roles and workspace isolation

Repeat read/write checks with Owner, Manager, a restricted Accounts role, normal Founder support and guarded test-write support.

Expected:

- RLS reads and command permissions remain workspace-scoped.
- Normal support is read-only.
- Direct browser writes to protected financial tables remain denied.
- No Customer, document, Payment or balance from another workspace appears.

## Acceptance record

Record:

- Deployment SHA and URL
- Tester and date/time
- Workspace and roles tested
- Invoice/Credit Note/Delivery Note/Payment test numbers
- Offline/conflict result
- Passed and failed checks
- Screenshots or exact error messages
- Decision: accept, correct and retest, or defer
