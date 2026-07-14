# BDB OS

BDB OS is a connected operating system for small businesses. It combines a public discovery experience with private, offline-friendly workspaces for invoicing, customers, bookings, communication, documents, banking, reporting, and lightweight automation.

## What is included

- A responsive dashboard with global search and an activity feed
- Customer management and connected invoice workflows
- Calendar bookings and communication drafts with approval steps
- Document tracking and upload metadata
- Banking reconciliation with human review
- Reports, automation controls, and business settings
- Browser persistence through `localStorage` in demo mode
- An installable web-app manifest and offline service worker
- Passwordless Supabase authentication foundations with tenant data protected by RLS
- Stripe server dependency ready for negotiated recurring subscriptions

The app ships with realistic demo data so every workflow is ready to explore immediately. Without environment variables, data stays in the current browser and no third-party account is required.

## Commercial model

- Starter, Growth and Pro are flexible starting points, not fixed feature bundles.
- Every client receives a tailored scope and quote after discovery.
- Clients pay monthly with an agreed minimum commitment of 3 or 6 months.
- A custom Stripe subscription should only be created after the quote and contract are agreed.

## Run locally

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

Copy `.env.example` to `.env.local` to enable Supabase authentication. Never expose the server-only Supabase or Stripe keys with a `NEXT_PUBLIC_` prefix.

## Quality checks

```bash
npm run lint
npm run build
```

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Marketing, plans and custom-quote journey |
| `/discovery` | Client discovery enquiry |
| `/login` | Passwordless client sign-in |
| `/workspace` | Daily overview and priorities |
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
- Supabase Auth/Postgres foundation
- Stripe subscription foundation
- Plain CSS design system

## Current scope

## Deployment

Deploy to Vercel, add the values from `.env.example`, and set the Supabase authentication Site URL and redirect allow-list to the deployed domain. The discovery form intentionally stays in preview mode until an approved inbox or CRM destination is selected.

Suggested production domains are `bdb-os.com` for marketing, `app.bdb-os.com` for client workspaces, and `admin.bdb-os.com` for the founder control plane.
