# BDB OS

BDB OS is a multi-tenant business operating system by Bianchini, Demicoli and Buontempo. Each client receives a private workspace with a tailored set of connected modules, a monthly contract, and an installable mobile experience.

## Product model

- Private Supabase-authenticated workspace for each client business
- Starter, Growth and Pro reference plans
- Bespoke per-client feature overrides and monthly quote
- Monthly billing with a 3- or 6-month minimum commitment
- Founder control centre for client provisioning, contracts, access and suspension
- Founder administration protected by TOTP multi-factor authentication
- Stripe Checkout and signed webhooks for subscription activation
- Client-selectable colours, light/dark mode, font, text scale, spacing and accessibility options
- Installable PWA with phone navigation; private pages and APIs are never written to the shared service-worker cache

Demo mode remains available for visual previews when Supabase is not configured. Live mode stores operational records in tenant-scoped tables protected by Row Level Security.

## Main routes

| Route | Purpose |
| --- | --- |
| `/` | Public BDB OS sales site |
| `/pricing` | Quote-led Starter, Growth and Pro plans |
| `/login` | Client authentication |
| `/workspace` | Signed-in business overview |
| `/accounts` | Invoices and payment tracking |
| `/customers` | Connected customer records |
| `/calendar` | Appointments and availability |
| `/communications` | Unified messages and assisted drafts |
| `/documents` | Connected files and upload records |
| `/banking` | Transaction reconciliation |
| `/reports` | Business reporting |
| `/automation-hub` | Human-approved automation |
| `/activity` | Workspace activity trail |
| `/settings` | Business, appearance, plan and billing settings |
| `/admin` | MFA-protected BDB founder control centre |
| `/mfa` | Founder authenticator enrolment and verification |

## Stack

- Next.js 16 App Router and React 19
- Supabase Auth and Postgres with RLS
- Stripe Checkout and webhooks
- Vercel deployment
- TypeScript generated from the live database schema
- Plain CSS theme tokens and an installable PWA

## Local setup

Use Node 20 or newer.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `NEXT_PUBLIC_BDB_DEMO_MODE=true` to explore the complete Pro workspace with local sample data. For live mode, set it to `false` and provide the Supabase values below.

## Environment variables

| Name | Exposure | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | Browser | Canonical app URL used for auth and billing redirects |
| `NEXT_PUBLIC_SUPABASE_URL` | Browser | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Browser | Modern Supabase publishable key |
| `SUPABASE_SECRET_KEY` | Server only | Founder provisioning and verified webhook writes |
| `STRIPE_SECRET_KEY` | Server only | Stripe Checkout and subscription reads |
| `STRIPE_WEBHOOK_SECRET` | Server only | Verifies raw Stripe webhook signatures |
| `NEXT_PUBLIC_BDB_DEMO_MODE` | Browser | Explicit design-preview mode |

Never commit `.env.local`, Stripe secrets, or the Supabase secret key. Add production values in Vercel Project Settings and scope them to Production and Preview as appropriate.

## Database

The migrations in [`supabase/migrations`](supabase/migrations) create:

- workspaces, memberships, profiles and MFA-gated platform administrators
- plans, plan features and time-bound per-workspace overrides
- contracts and Stripe subscription state
- workspace themes and business settings
- tenant-owned customers, invoices, bookings, messages, documents, banking records, automations and activity
- explicit grants, RLS policies, tenant-safe composite foreign keys and covering indexes

Apply migrations in order through the Supabase CLI or migration tooling. After any DDL change, run Supabase security and performance advisors and regenerate [`src/lib/supabase/database.types.ts`](src/lib/supabase/database.types.ts).

## Founder bootstrap

Do not hardcode founder emails in the application. Bootstrap Nicholas, Giovanni and Matthew by immutable Auth user IDs:

1. Invite each founder through Supabase Authentication.
2. Each founder signs in and enrols an authenticator at `/mfa`.
3. In the Supabase SQL editor, look up and verify the three IDs:

```sql
select id, email from auth.users order by created_at;
```

4. Insert only the verified IDs:

```sql
insert into public.platform_admins (user_id, role)
values
  ('FIRST-VERIFIED-UUID', 'founder'),
  ('SECOND-VERIFIED-UUID', 'founder'),
  ('THIRD-VERIFIED-UUID', 'founder')
on conflict (user_id) do update set role = excluded.role, active = true;
```

The admin authorization helper requires both an active `platform_admins` row and an `aal2` Supabase session. Possessing a normal client login or changing user metadata cannot grant founder access.

## Stripe setup

1. Add Stripe test keys to Vercel.
2. Create a webhook endpoint for `https://YOUR-DOMAIN/api/stripe/webhook`.
3. Subscribe it to `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, and `customer.subscription.deleted`.
4. Copy the signing secret into `STRIPE_WEBHOOK_SECRET`.
5. Use test mode until contract activation, status transitions and failed-payment suspension have been verified end to end.

Checkout pricing is created only from the founder-issued database contract. The browser cannot submit its own amount or term.

## Quality checks

```bash
npm run lint
npx tsc --noEmit
npm run build
```

Before production promotion, test login, workspace isolation, founder MFA, invite delivery, feature locking, appearance persistence, Stripe test checkout, webhook retries and mobile install behaviour on the Vercel preview URL.
