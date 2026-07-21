# Vanita Stock — Client Project

> **Project scope:** This folder contains the dedicated stock, document, product, service, supplier, client and sales application for **Vanita Beauty and Wellness Spa**. It is maintained separately from the BDB OS application and is stored in the `bdb-os` repository only for central version control.

## Live application

[**Open the Vanita Stock application →**](https://vanita-stock.vercel.app)

The source code is stored in GitHub, while the working application is hosted by Vercel.

Vanita Stock is a mobile-friendly beauty-product inventory, supplier-document and lightweight client-management system tailored for Vanita Beauty and Wellness Spa. The sample data reflects the supplied Makiba Essence and Collis Williams paperwork.

1. Take a photo of or upload a supplier invoice or credit note.
2. Review the extracted supplier, document type, item purpose, stock codes, quantities and prices.
3. Add invoice quantities to stock, or upload the original to Documents without changing stock.
4. Maintain separate product and salon/spa service catalogues.
5. Maintain supplier contacts linked to products, documents and net supplier spend.
6. Maintain client contacts and optionally assign a client to each recorded sale.
7. Record products and services together in the same sale, including the assigned service staff member and fixed line or basket discounts.
8. See low-stock products immediately and optionally receive browser notifications.

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

Opening through a local server is recommended because phone-camera scanning, notifications, and offline installation require a secure browser context (`localhost` is accepted by browsers).

## Application notes

- The deployed application uses Supabase for shared staff data and authentication, with `localStorage` as the local fallback.
- Supplier invoices and credit notes are extracted through the server-side document extraction endpoint and remain editable before stock is updated.
- Phone camera barcode scanning uses the browser `BarcodeDetector` API when available. USB and Bluetooth scanners work through the barcode/search field because they typically behave like keyboards.
- The included web-app manifest and service worker allow installation and offline use after the first visit.

## Online version

The app now supports an optional Supabase-backed shared dataset and staff login when deployed to Vercel. Without cloud configuration it continues to run in local demo mode. See `ONLINE_SETUP.md` for the one-time setup and deployment checklist.
