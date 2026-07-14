# BDB OS

BDB OS is a connected, offline-first operating workspace for small businesses. It brings invoicing, customers, bookings, communication, documents, banking, reporting, and lightweight automation into one calm interface.

## What is included

- A responsive dashboard with global search and an activity feed
- Customer management and connected invoice workflows
- Calendar bookings and communication drafts with approval steps
- Document tracking and upload metadata
- Banking reconciliation with human review
- Reports, automation controls, and business settings
- Browser persistence through `localStorage`
- An installable web-app manifest and offline service worker

The app ships with realistic demo data so every workflow is ready to explore immediately. Data stays in the current browser; no external database or third-party account is required for this MVP.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Quality checks

```bash
npm run lint
npm run build
```

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Daily overview and priorities |
| `/accounts` | Invoices and cash flow |
| `/customers` | Customer records |
| `/calendar` | Bookings and schedule |
| `/communications` | Messages and draft approvals |
| `/documents` | Business documents |
| `/banking` | Transaction reconciliation |
| `/reports` | Performance reporting |
| `/automation-hub` | Automation controls |
| `/activity` | Audit trail |
| `/settings` | Workspace preferences |

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Lucide icons
- Plain CSS with no UI runtime dependency

## Current scope

This version is a production-buildable front-end MVP. Persistence is intentionally local to the browser. A future multi-user release can replace the store layer with authenticated APIs and a database without changing the page-level product model.
