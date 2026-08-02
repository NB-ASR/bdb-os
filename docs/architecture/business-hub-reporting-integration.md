# Business Hub and Reporting integration

## Business problem

BDB OS needs one trusted place where a business user can understand where work is happening, what needs attention and what changed recently without opening every department. The legacy workspace dashboard calculated a small number of figures from the shared browser store, so it could not represent the authoritative operational integrations or preserve department permissions reliably.

## Ownership

The Business Hub and Reports are read-only orchestration surfaces.

They do not own Customers, Appointments, Sales, Invoices, Payments, Communications, Documents, Bank Transactions, Purchasing Documents or Inventory balances. Every displayed signal is derived from the department that owns the underlying record.

The Business Hub owns only presentation concerns:

- department navigation;
- permission-aware signals;
- priority ordering;
- exact source-record routes;
- the last trusted offline snapshot.

Reports owns only analytical presentation of authoritative records. It does not create a reporting ledger or copy operational rows.

## Version 1 scope

The Business Hub answers three questions:

1. Where should the user go?
2. What needs attention?
3. What changed recently?

It provides:

- circular department navigation around the business identity;
- one meaningful signal per visible department;
- exact cross-department attention actions;
- recent Customer-centred and operational activity;
- permission-aware quick actions;
- currency-separated financial positions;
- cached offline reopening after one online load.

Reports provides:

- completed Sales by currency;
- received Customer Payments by currency;
- issued, open and overdue Invoices by currency;
- Customer and Supplier outstanding positions by currency;
- unreconciled bank movement by currency;
- monthly completed Sales trends by currency;
- largest Customers by completed Sales and currency;
- operational counts that are safe to compare without financial conversion.

## Currency rule

Values from different currencies are never combined. Counts may be combined where their meaning is currency-independent, but monetary values remain grouped by their recorded ISO currency.

BDB OS does not infer exchange rates, base-currency equivalents, profit, tax, cash runway or forecasts in this integration.

## Permission model

`get_business_hub_access` evaluates the signed-in caller through `private.has_workspace_permission`. The function is `SECURITY INVOKER`.

All Business Hub and Reporting views use `security_invoker = true`. Browser clients receive `SELECT` only and continue through the existing source-table RLS policies. The API filters records again by department access as defence in depth.

Founder support remains read-only unless the guarded integration test-write mode is active. The Hub exposes no mutation endpoint.

## Read models

- `business_hub_operational_metrics`: one workspace-level operational summary.
- `business_hub_currency_metrics`: financial signals grouped by workspace and currency.
- `business_hub_attention`: exact source-record actions with department, priority and route.
- `business_hub_recent_activity`: Customer 360 activity plus non-customer operational activity.
- `business_report_monthly_sales`: completed Sales by month and currency.
- `business_report_customer_sales`: completed Sales by Customer and currency.

The views are replaceable projections. Source department tables and ledgers remain the system of record.

## Offline behaviour

The Hub and Reports cache the last successful API payload per workspace in browser storage. While offline:

- cached department signals remain readable;
- cached financial metrics remain currency-separated;
- cached attention and activity remain navigable;
- the interface states that the data is cached;
- refresh is disabled until reconnection;
- no fabricated live state is shown.

This integration adds no offline mutations because both surfaces are read-only.

## Visual behaviour

The Business Hub preserves the BDB OS identity:

- dark charcoal workspace;
- dark-gold circular department nodes;
- central business identity;
- minimal copy;
- visible attention badges;
- Customer-centred activity;
- responsive list conversion on small screens.

Reports remains a secondary analytical workspace. It does not replace the Business Hub with a conventional chart dashboard.

## Deferred

- configurable dashboard widgets;
- drag-and-drop layouts;
- exchange-rate conversion;
- profit and loss reporting;
- tax reporting;
- forecasts and AI business decisions;
- saved report builders;
- scheduled report delivery;
- external BI integrations.
