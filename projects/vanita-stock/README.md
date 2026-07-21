# Vanita Stock — Client Project

> **Project scope:** This folder contains the dedicated stock, document, product, service, supplier, client, appointment and sales application for **Vanita Beauty and Wellness Spa**. It is maintained separately from the BDB OS application and is stored in the `bdb-os` repository only for central version control.

## Live application

[**Open the Vanita Stock application →**](https://vanita-stock.vercel.app)

The source code is stored in GitHub, while the working application is hosted by Vercel.

### Current production release

- **Release:** v24 — Calendar and appointment scheduling
- **Deployed:** 21 July 2026
- **Runtime source commit:** `9b7eab104cc3aaae931b59db413b2e7de9bc3333`
- **Vercel production deployment:** `dpl_7tKSSVmRRyDQqKLksvKSRpP8vNaG`
- **Branch:** `agent/vanita-stock-project`
- Production is loaded from the pinned runtime commit above; no release changes were made to `main`.

Vanita Stock is a mobile-friendly beauty-product inventory, supplier-document, client-management and appointment-scheduling system tailored for Vanita Beauty and Wellness Spa. The sample data reflects the supplied Makiba Essence and Collis Williams paperwork.

1. Take a photo of or upload a supplier invoice or credit note.
2. Review the extracted supplier, document type, item purpose, stock codes, quantities and prices.
3. Add invoice quantities to stock, or upload the original to Documents without changing stock.
4. Maintain separate product and salon/spa service catalogues.
5. Maintain supplier contacts linked to products, documents and net supplier spend.
6. Maintain client contacts and connect clients to appointments and recorded sales.
7. Schedule appointments across Day, Week, Month and Agenda views.
8. Assign one or more services and qualified staff members to each appointment.
9. Record products and services together in the same sale, including the assigned service staff member and fixed line or basket discounts.
10. See low-stock products immediately and optionally receive browser notifications.
11. Open a tab-specific visual guide that explains the controls and reports currently shown on screen.
12. Open a Settings tab with planned configuration areas and backup, restore and selective-reset tools.
13. Open and share the Test Version without requiring a staff login.

## Release v24 — Calendar and appointment scheduling

- Added a dedicated **Calendar** tab to desktop and mobile navigation.
- Added **Day**, **Week**, **Month** and **Agenda** views with Today and previous/next period controls.
- Added appointment search and filters for staff member and appointment status.
- Appointments support an existing client or quick client creation, multiple services, a separate staff assignment for each service, duration, price, discount, deposit, booking source, room, reminder status and notes.
- Service duration, price and qualified staff are loaded from the Services catalogue and remain editable for the individual appointment.
- Added appointment statuses for Tentative, Confirmed, Checked in, In progress, Completed, Cancelled and No-show.
- Added appointment actions to edit/reschedule, duplicate, progress through statuses, cancel, mark as no-show, delete and convert completed appointments into sales.
- Appointment-to-sale conversion preloads the client, service lines, staff assignments and appointment discount. Paid deposits are retained separately from revenue and reduce the remaining checkout balance.
- Added per-team-member weekly working hours and blocked periods for breaks, leave, training or other unavailability.
- Added conflict checks for staff double-booking, blocked time, working hours and service qualifications, with suggested alternative start times and an explicit Test Version override.
- Appointment records and calendar settings are stored in the browser-local workspace.
- Full backups include appointments and calendar settings. Restore supports replacement and appointment merging, and Reset Individual Data Areas now includes Appointments.
- Added a Calendar-specific contextual quick guide.
- Release v24 is included in the offline application cache.

## Release v23 — permanent no-login Test Version

- Removed the staff-login and Supabase-session requirement from the application runtime.
- The top-right environment indicator now displays **Test Version**.
- All visitors can use the operational application functions, including the Settings Danger Zone tools, within their browser-local workspace.
- Products, services, suppliers, clients, sales, document records, settings and activity history are stored in browser `localStorage`.
- Original uploaded invoice and credit-note files are stored in browser IndexedDB and can be opened, downloaded or deleted from Documents.
- AI supplier-document extraction remains enabled without a staff session through the test-version endpoint.
- The extraction endpoint applies origin checks and a best-effort limit of 12 requests per IP per hour to reduce accidental or abusive usage.
- Each browser remains an independent workspace. Data and locally stored files do not sync between devices or other visitors.
- JSON backups contain the application state and document metadata; IndexedDB file blobs are not embedded in the JSON backup.
- Release v23 refreshes the offline application cache.

## Release v22 — temporary public test mode

- Temporarily disabled the staff login requirement so the production link could be opened and shared for testing.
- Public test sessions did not load or update the shared Supabase workspace; each browser used its own isolated local dataset.
- The header displayed **Public test · local only** to make the temporary data mode clear.
- Cloud document uploads, stored-document access and authenticated AI document extraction were unavailable in this release.
- Owner and Developer Danger Zone controls remained locked for public visitors.
- Release v22 refreshed the offline application cache.

## Release v21 — settings and Danger Zone data tools

- Added a dedicated **Settings** tab to desktop and mobile navigation.
- Added placeholder sections for My Account, Business Profile, Team and Access, Inventory, Services, Sales, Supplier and Documents, Clients and Privacy, Notifications, Data and Reporting, Security and Developer Tools.
- Placeholder settings are marked as planned and do not change application behaviour in this release.
- Added a visually separated **Danger Zone** for privileged data-management tools.
- **Create Full Backup** downloads a versioned JSON copy of the complete application state and record counts.
- Backups include products, services, suppliers, clients, sales, document metadata, activities, team records and settings.
- **Restore From Backup** validates JSON files up to 25 MB, previews record counts and supports complete replacement or merging missing records.
- Restore automatically downloads a pre-restore backup, requires the typed confirmation **RESTORE** and preserves the existing access configuration.
- **Reset Individual Data Areas** supports Inventory quantities, Products, Services, Suppliers, Clients, Sales, Documents and Activity history.
- Reset displays the impact of each area, downloads a pre-reset backup and requires the typed confirmation **RESET**.
- Release v21 is included in the offline application cache.

## Release v20 — contextual quick guide

- Replaced the previous quick-guide toast with a full-screen contextual tutorial overlay.
- The guide detects the active tab and loads a dedicated sequence for Overview, Inventory, Products, Services, Suppliers, Clients, Documents or Sales.
- Only one tutorial bubble is displayed at a time, with a visual pointer and highlighted target area showing the feature being explained.
- Added previous and next arrow controls, an **X** close control and a centred progress counter such as **5/10**.
- The guide automatically scrolls the relevant screen element into view and repositions the bubble around the available viewport space.
- Added keyboard support: left/right arrows move through the guide and Escape closes it.
- The overlay blocks accidental interaction with the highlighted screen while the guide is open.
- Release v20 is included in the offline application cache.

## Release v19 — optional service codes and team-member selection

- Service codes are now optional; blank codes can be saved without triggering duplicate-code validation.
- The Services table labels the field as **Code (optional)** and shows an em dash where no code is used.
- Qualified staff are selected through a dedicated team-member view rather than typed as comma-separated names.
- The picker shows each employee's name, job title, placeholder `@vanita.com` email and app-access status.
- Added placeholder employee records for a Beautician, Nail Technician, Massage Therapist, Hair Stylist and Receptionist.
- Service-to-staff links use stable team-member IDs while retaining staff names for existing sales and reports.
- Existing free-text staff names are migrated into selectable team-member records automatically.
- Release v19 is included in the offline application cache.

## Release v18 — supplier and client registers

- Added a dedicated **Suppliers** tab with contact details, status, linked product count, linked document count, net spend and latest-document date.
- Existing supplier names are migrated automatically from the Products and Documents data already stored in the app.
- Supplier names can be selected from the directory when editing a product or reviewing an imported supplier document.
- Renaming a supplier updates its linked products and documents; suppliers with linked records are archived rather than deleted.
- Added a dedicated **Clients** tab with contact details, preferred services, notes, visit count, total spend and last-visit date.
- Sales can be assigned to an active client or left as an unassigned walk-in, and completed-sale editing retains or changes the client link.
- Client-linked sales show the client in Sales history; clients with linked sales are archived rather than deleted.
- Supplier and client records are searchable from their tabs and from the global app search.
- Mobile users can open Products, Services, Suppliers and Clients through the expanded Catalogue & contacts menu.

## Release v17 — supplier discounts and reporting foundation

- Supplier-document extraction now reads the printed subtotal before discount, supplier discount, net after discount, VAT and final amount paid.
- Inventory and Dashboard stock valuation continue to use the full printed product unit costs before supplier-level discount.
- The document review screen shows an editable supplier discount, paid net cost and actual paid total.
- Saved document records retain both valuation bases: catalogue stock cost and actual discounted supplier spend.
- The Documents summary now reports supplier discounts captured and actual supplier spend as the first purchasing-reporting dataset.
- Historical documents remain compatible and are treated as having no separately recorded supplier discount.

## Release v16 — sales, barcode and document controls

- Product barcodes can be typed or captured with the camera from **Products → Edit**; duplicate barcode assignments are blocked.
- Completed sales with saved basket details can be opened and corrected. The original product movement is reversed before the revised basket is applied.
- A final checkout screen supports fixed monetary discounts on individual product/service lines and on the whole basket.
- Reviewed documents can be uploaded to Documents without adding or removing stock.
- Invoice items can be classified as **Resale stock** or **Business supplies**. Supplies remain quantity-tracked in Inventory but are excluded from resale stock cost and potential RRP value and cannot be added to a customer sale.

## Run locally

The app has no package installation or build step. Double-click `Open Vanita Stock.cmd` in this folder. It starts the app and opens the browser automatically.

Alternatively, open PowerShell in this folder and run:

```powershell
powershell -ExecutionPolicy Bypass -File .\Start-StockFlow.ps1
```

The launcher opens `http://localhost:8080` automatically. Keep its PowerShell window open while using the app. To stop it, press `Ctrl+C` in that window or double-click `Close Vanita Stock.cmd`.

Opening through a local server is recommended because phone-camera scanning, notifications, IndexedDB document storage and offline installation require a secure browser context (`localhost` is accepted by browsers).

## Application notes

- No staff login is required in the current Test Version.
- Application data, including appointments and calendar settings, is stored in browser `localStorage`; original uploaded documents are stored separately in browser IndexedDB.
- Supplier invoices and credit notes are extracted through the server-side document extraction endpoint and remain editable before stock is updated.
- Phone camera barcode scanning uses the browser `BarcodeDetector` API when available. USB and Bluetooth scanners work through the barcode/search field because they typically behave like keyboards.
- The included web-app manifest and service worker allow installation and offline use after the first visit.
- Clearing browser site data removes the workspace data and locally stored original documents for that browser.

## Online version

The Vercel deployment runs as a no-login Test Version. Each browser has its own independent workspace and does not share operational data with other devices or visitors.
