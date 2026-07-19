# SOP — Client Stock and Invoice Management System

**Owner:** BDB  
**Version:** 1.0  
**Effective date:** 14 July 2026  
**Review cycle:** After every client pilot or at least quarterly

## 1. Purpose

Provide a repeatable process for designing, building, deploying, and supporting a secure stock and invoice-management system for a client whose inventory is currently tracked manually.

The standard outcome is a phone- and scanner-friendly application that can capture supplier invoices and credit notes, update stock after human review, deduct sold items, identify products requiring restocking, and provide secure shared access for authorised staff.

## 2. Scope

Use this SOP from initial client qualification through pilot handover and ongoing support. It applies to client-specific implementations built from the BDB stock-system foundation.

This SOP does not authorise unattended financial posting, purchasing, or deletion of client records. Extracted document data must be reviewed before it changes inventory.

## 3. Roles

- **Project owner:** Owns scope, schedule, client communication, acceptance, and ClickUp records.
- **Implementation lead:** Configures branding, workflows, database, hosting, and integrations.
- **Client administrator:** Approves product rules, creates or authorises staff accounts, and owns access decisions.
- **Client testers:** Perform realistic stock, invoice, credit-note, and sales scenarios.
- **Support owner:** Monitors incidents, backups, access changes, and improvement requests after launch.

One person may hold multiple roles, but every role must have a named owner before the pilot starts.

## 4. Required records

Create the following in ClickUp before implementation:

1. An active-client record containing the business problem, stakeholders, location, and engagement status.
2. A client-delivery project containing the scope, architecture, links, decisions, completed work, blockers, and next milestone.
3. Delivery tasks for authentication, invoice extraction, workflow testing, notifications, onboarding, and pilot feedback.
4. Dated progress updates after material changes.
5. A source snapshot or repository link that excludes passwords, service-role keys, and other secrets.

## 5. Procedure

### Phase 1 — Qualification and discovery

1. Confirm the client currently has a stock-management problem worth solving.
2. Identify locations, users, product count, suppliers, sales channels, and existing tools.
3. Collect representative invoices, credit notes, product lists, and stock reports with permission.
4. Document how stock currently enters and leaves the business.
5. Define restock thresholds, damaged stock, returns, testers, and approval responsibilities.
6. Agree the pilot outcome and exclusions.

**Gate:** Do not build until the current workflow, pilot users, sample documents, and acceptance criteria are documented.

### Phase 2 — Document and data analysis

1. Catalogue every sample document by supplier and document type.
2. Identify supplier name, document number, dates, currency, product description, SKU/barcode, quantity, unit cost, discount, tax, and totals.
3. Determine how credit-note quantities reverse previous stock receipts.
4. Create matching rules for existing products and a review path for unknown products.
5. Define the minimum confidence required for automatic field suggestions.
6. Require a human confirmation screen before applying stock movements.

**Gate:** A sample cannot update stock until totals, signs, duplicate detection, and product matching have been tested.

### Phase 3 — Solution design

1. Create a client-specific project from the approved BDB foundation.
2. Apply the client's name, brand, location, users, terminology, and example products.
3. Confirm the minimum modules: overview, inventory, documents, sales, stock movements, and restock alerts.
4. Define the data model, authentication model, hosting, backups, and audit trail.
5. Use a dedicated client database unless a reviewed multi-tenant architecture is in place.
6. Record architectural decisions and known limitations in ClickUp.

### Phase 4 — Security and environment setup

1. Create separate hosting and database projects for the client.
2. Store configuration in protected hosting environment variables.
3. Use only a public/publishable client key in the browser.
4. Never expose database passwords, secret keys, or service-role credentials.
5. Enable row-level security on all exposed tables.
6. Revoke anonymous access unless a specific public workflow has been approved.
7. Grant authenticated users only the operations required by the application.
8. Create staff accounts directly or by invitation according to the client's onboarding decision.
9. Remove access promptly when staff leave or change roles.

**Gate:** Production access is blocked until authentication, permissions, and anonymous-access tests pass.

### Phase 5 — Build and configuration

1. Configure inventory fields, restock levels, suppliers, and document types.
2. Implement received-stock, sale, return, adjustment, credit-note, and damaged-stock movements.
3. Make all stock changes traceable to a user, time, reason, and source document where applicable.
4. Prevent duplicate invoice processing.
5. Preserve the original uploaded document or a secure reference to it.
6. Add clear error, loading, offline, and retry states.
7. Ensure the interface works on the client's phones and desktop devices.

### Phase 6 — Deployment

1. Run syntax, configuration, and local workflow checks.
2. Deploy a preview environment and complete a visual check.
3. Add production environment variables through the hosting platform, never the source archive.
4. Deploy the complete project to production.
5. Verify the production URL, configuration endpoint, login screen, and error logs.
6. Record deployment links and versions in ClickUp.

### Phase 7 — Verification

Run the following end-to-end scenarios in production or a production-equivalent environment:

- New staff user can sign in and unauthorised visitors cannot access stock.
- Initial shared state loads on two separate devices or sessions.
- Invoice import creates a reviewable draft.
- Confirming an invoice increases the correct product quantities once.
- Re-importing the same invoice is detected.
- Credit note reduces or reverses the correct received stock.
- Recording a sale deducts the correct quantities.
- Manual adjustment requires a reason and appears in history.
- Restock warning appears at the configured threshold.
- Out-of-stock state appears at zero and stock cannot silently become invalid.
- Refreshing or reopening the application preserves shared data.

Record expected result, actual result, tester, date, evidence, and defects.

**Gate:** The pilot cannot start while a critical authentication, data-loss, duplicate-processing, or stock-calculation defect is open.

### Phase 8 — Client onboarding and pilot

1. Create the authorised staff accounts.
2. Provide a short guide for login, invoice review, sales, corrections, and support.
3. Demonstrate one complete invoice-to-sale workflow.
4. Observe the client's first real transaction.
5. Run the pilot for the agreed period and capture feedback in ClickUp.
6. Separate defects from new feature requests.
7. Obtain written acceptance or document outstanding conditions.

### Phase 9 — Ongoing operation

1. Review low-stock alerts, failed imports, access changes, and reported discrepancies.
2. Reconcile a sample of physical stock against the system on an agreed schedule.
3. Review database backups and restoration procedures.
4. Rotate or replace credentials when required.
5. Test changes in preview before production.
6. Add dated ClickUp updates for releases, decisions, incidents, and verification results.
7. Update this SOP after lessons that should apply to future clients.

## 6. Definition of done

A client implementation is ready for handover when:

- scope and acceptance criteria are approved;
- client branding and workflows are configured;
- sample invoices and credit notes have passed review tests;
- authentication and row-level security are verified;
- anonymous stock access is blocked;
- the production application is available and error-free;
- the end-to-end stock workflow has passed;
- staff have been onboarded;
- support ownership and escalation routes are documented;
- ClickUp contains the current specification, links, evidence, open work, and source reference.

## 7. Change-control rule

Every material change must update the ClickUp delivery project. A material change includes scope, workflow, data model, security, deployment, client decision, blocker, incident, verification result, or release. Update the reusable SOP only when the lesson applies beyond one client.

