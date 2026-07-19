# Vanita Stock — Client Project

> **Project scope:** This folder contains the dedicated stock, document, product, service and sales application for **Vanita Beauty and Wellness Spa**. It is maintained separately from the BDB OS application and is stored in the `bdb-os` repository only for central version control.

## Live application

[**Open the Vanita Stock application →**](https://vanita-stock.vercel.app)

The source code is stored in GitHub, while the working application is hosted by Vercel.

Vanita Stock is a mobile-friendly beauty-product inventory and supplier-document manager tailored for Vanita Beauty and Wellness Spa. The sample data reflects the supplied Makiba Essence and Collis Williams paperwork.

1. Take a photo of or upload a supplier invoice or credit note.
2. Review the extracted supplier, document type, item purpose, stock codes, quantities and prices.
3. Add invoice quantities to stock, or upload the original to Documents without changing stock.
4. Maintain separate product and salon/spa service catalogues.
5. Record products and services together in the same sale, including the assigned service staff member and fixed line or basket discounts.
6. See low-stock products immediately and optionally receive browser notifications.

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
