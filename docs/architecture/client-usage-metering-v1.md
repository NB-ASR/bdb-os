# BDB OS V1 Client Usage Metering

## Decision

BDB OS measures client usage per workspace inside the existing shared multi-tenant platform. Measurement is internal and Founder-only in V1. It does not automatically invoice, charge Stripe, suspend a workspace, or expose raw Supabase/provider billing.

## Business problem

BDB needs trustworthy per-client consumption evidence before package allowances, overages, or automated charging can be commercially safe. Raw provider invoices are platform-level and are not a reliable customer billing model.

## Ownership and records

Founder Admin owns commercial visibility. Usage connects to the existing workspace, plan, memberships, private storage, Operator runs, Communications, and core business transaction records. `workspace_id` is mandatory throughout the metering model.

## Schema

### `plan_usage_allowances`

Extends the existing Plans engine with optional included quantities for storage bytes, active users, automation executions, outbound emails, and SMS segments. `NULL` means the allowance has not yet been commercially configured. This is not a second pricing engine.

### `workspace_usage_periods`

Creates one UTC calendar-month measurement period per workspace. When first observed it snapshots the workspace plan identity and plan allowances. Later plan edits therefore do not rewrite the historical period.

### `workspace_usage_events`

Append-only idempotent evidence for event-style usage. V1 meters automation executions from durable `operator_runs` and outbound email from durable outbound Email `messages`. The unique workspace/metric/idempotency contract protects offline retries and reconciliation from double-counting.

### `workspace_usage_baselines`

Stores the trustworthy starting point for point-in-time resources when metering is enabled. V1 baselines storage bytes and active users. Baselines are not reconstructed historical billing.

## Measurement sources

- File storage: live object bytes in the private `workspace-documents` and `workspace-assets` buckets, scoped by workspace path prefix.
- Active users: live active `workspace_memberships`. Invited users are contextual and are not counted as active seats.
- Automation executions: `operator_runs` once a run enters execution or an execution terminal state. A trigger is best-effort and reconciliation repairs missed meter events.
- Outbound emails: durable outbound Email communications with `draft_state = 'none'`. This is recorded outbound communication evidence, not yet separate provider-delivery evidence.
- SMS segments: metric and allowance are reserved but the source is `not_connected` until a real SMS transport exists. No SMS usage is inferred.
- Exceptional usage indicators: non-billable Founder context such as monthly Sales, invoices, appointments, Communications, Operator runs, total Customers, and total Documents.

## Reliability

Meter triggers swallow metering failures so customer workflows remain authoritative. Founder usage reads reconcile event meters from source records using deterministic idempotency keys. Point-in-time resources are read live rather than treated as additive events.

## Security

Usage tables are RLS enabled. Browser read access is restricted to active Platform Admins through the existing Founder security boundary. Meter write/reconcile/summary functions are service-role only and the public Founder API still requires MFA-backed `requirePlatformAdmin()`.

## V1 commercial boundary

No allowance is automatically treated as chargeable until Founders configure it. No overage creates an invoice. No meter calls Stripe. No workspace is suspended for usage. The release sequence is measurement -> Founder observation -> validated allowances/overage calculations -> automated charging later.

## Risks and future implications

Recorded Email is not provider-delivery evidence, and SMS has no transport yet. Those categories must be upgraded when provider integrations arrive. Calendar-month periods are a deliberate V1 simplification; subscription-anniversary periods can be introduced later without changing the append-only event evidence model.
