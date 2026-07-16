# BDB OS

BDB OS is a connected operating system for small businesses. It combines private client workspaces, invitation-based team access and an MFA-protected Founder control plane.

## What is included

- A responsive business workspace with global search and an activity feed
- Customer management and connected invoice workflows
- Calendar bookings and communication drafts with approval steps
- Document tracking and private workspace storage
- Banking reconciliation with human review
- Reports, automation controls, and business settings
- Installable PWA, offline service worker, app shortcuts and appointment push reminders
- Email and password authentication with password reset support
- Mandatory first-login credential replacement and MFA for BDB Founders
- Founder-provisioned businesses; public users cannot create their own tenant
- Secure Business Owner and employee invitation activation
- Owner, Manager, Employee and Custom access profiles
- Per-user permissions for view, create, edit, delete, approve and export
- Plan entitlements and per-client overrides enforced in middleware and Supabase RLS
- Business Groups for deliberately linked parent companies, subsidiaries and sister companies
- A restricted company switcher that excludes unrelated businesses
- Final active Owner and final active Founder protections
- Client themes, accessibility settings and private logo storage
- Founder controls for clients, plans, modules, invitations, groups, contracts and audit logs
- Custom Stripe subscription links, trials, billing portal and signed webhook synchronisation

Public preview workflows may use browser-local demonstration data when Supabase is not configured. Authenticated Founder Admin and Team Management screens never fall back to fake client or employee records.

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

Copy `.env.example` to `.env.local` to enable Supabase authentication. Never expose server-only Supabase, Founder bootstrap or Stripe secrets with a `NEXT_PUBLIC_` prefix.

## Quality checks

```bash
npx tsc --noEmit
npm run lint
npm run build
```

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Marketing, plans and custom-quote journey |
| `/discovery` | Client discovery enquiry |
| `/login` | Email and password sign-in and password reset |
| `/activate` | Secure invited-owner and employee activation |
| `/change-password` | First-login and password-reset credential replacement |
| `/workspace` | Daily overview and priorities |
| `/accounts` | Invoices and cash flow |
| `/customers` | Customer records |
| `/calendar` | Bookings and schedule |
| `/communications` | Messages and draft approvals |
| `/documents` | Business documents |
| `/banking` | Transaction reconciliation |
| `/reports` | Performance reporting |
| `/automation-hub` | Automation controls |
| `/activity` | Workspace audit trail |
| `/settings` | Business, appearance and billing controls |
| `/team` | Employee invitations, roles, suspension and permissions |
| `/admin` | MFA-protected BDB Founder control plane |
| `/mfa` | Founder authenticator enrolment and verification |

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Lucide icons
- Supabase Auth, Postgres, Storage and RLS
- Stripe custom subscriptions and webhooks
- Vercel Cron appointment notifications
- Plain CSS design system

## Deployment

Deploy to Vercel, add the values from `.env.example`, and set the Supabase authentication Site URL and redirect allow-list to the deployed domain. Apply the V1 migrations in filename order, configure the Founder email/name lists and one-time bootstrap secrets, then run the protected Founder bootstrap endpoint once. Every Founder must replace the initial credential and enrol MFA before `/admin` opens.

Follow `docs/v1-foundation-runbook.md` for the complete migration, bootstrap, invitation, permissions and business-isolation acceptance checklist.

The appointment reminder worker is `/api/cron/appointment-reminders`. Vercel Hobby only permits daily cron jobs, which is not frequent enough for timely reminders. On Vercel Pro, copy `docs/vercel-pro.cron.json` to `vercel.json` to run it every ten minutes; alternatively call the endpoint from a trusted external scheduler with `Authorization: Bearer $CRON_SECRET`.

Suggested production domains are `bdb-os.com` for marketing, `app.bdb-os.com` for client workspaces, and `admin.bdb-os.com` for the Founder control plane.
