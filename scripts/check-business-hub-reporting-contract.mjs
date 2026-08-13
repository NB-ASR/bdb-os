import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(path, "utf8");

const [
  architecture,
  decision,
  accessMetrics,
  attentionActivity,
  reportingViews,
  hubApi,
  reportsApi,
  hubPage,
  hubStyles,
  reportsPage,
  cache,
] = await Promise.all([
  read("docs/architecture/business-hub-reporting-integration.md"),
  read("docs/decisions/2026-08-02-business-hub-read-only-orchestration.md"),
  read("supabase/release-sources/vanita-integration-20260813/20260802140000_business_hub_access_and_metrics.sql"),
  read("supabase/release-sources/vanita-integration-20260813/20260802140500_business_hub_attention_activity.sql"),
  read("supabase/release-sources/vanita-integration-20260813/20260802141000_business_reporting_views.sql"),
  read("src/app/api/business-hub/route.ts"),
  read("src/app/api/reports/route.ts"),
  read("src/app/workspace/page.tsx"),
  read("src/app/workspace/business-hub.module.css"),
  read("src/app/reports/page.tsx"),
  read("src/lib/modules/business-insight-cache.ts"),
]);

assert.match(architecture, /read-only orchestration surfaces/i, "Business Hub and Reports must remain read-only orchestration.");
assert.match(architecture, /different currencies are never combined/i, "Currency separation must be explicit.");
assert.match(decision, /will not own copies of operational or financial records/i, "The ownership decision must reject duplicate Hub state.");

assert.match(accessMetrics, /function public\.get_business_hub_access/i, "Permission-aware Business Hub access must exist.");
assert.match(accessMetrics, /security invoker/i, "Business Hub access and views must preserve caller permissions.");
assert.match(accessMetrics, /view public\.business_hub_operational_metrics/i, "Operational metrics must exist.");
assert.match(accessMetrics, /view public\.business_hub_currency_metrics/i, "Currency metrics must exist.");
assert.match(accessMetrics, /group by workspace_id, currency/i, "Financial metrics must remain currency-separated.");
assert.doesNotMatch(accessMetrics, /(exchange_rate|currency_conversion|base_currency_amount)/i, "The Hub must not invent currency conversion.");
assert.match(accessMetrics, /supplier_payable_balances/i, "Reporting must include authoritative Supplier Payables.");
assert.match(accessMetrics, /inventory_product_totals/i, "The Hub must use authoritative Inventory balances.");

assert.match(attentionActivity, /view public\.business_hub_attention/i, "Exact attention actions must exist.");
assert.match(attentionActivity, /\/accounts\?tab=invoices&invoiceId=/i, "Invoice actions must route to exact records.");
assert.match(attentionActivity, /\/communications\?threadId=/i, "Communication actions must route to exact threads.");
assert.match(attentionActivity, /\/calendar\?appointment=/i, "Appointment actions must route to exact records.");
assert.match(attentionActivity, /\/inventory\?productId=/i, "Stock actions must route to exact Products.");
assert.match(attentionActivity, /customer_360_activity/i, "Business Hub activity must reuse Customer 360.");
assert.match(attentionActivity, /activity_items/i, "Business Hub activity must include non-customer operations.");

assert.match(reportingViews, /business_report_monthly_sales/i, "Monthly Sales reporting must exist.");
assert.match(reportingViews, /business_report_customer_sales/i, "Customer Sales reporting must exist.");
assert.match(reportingViews, /sale\.status = 'completed'/i, "Reports must use completed Sales only.");
assert.match(reportingViews, /month_start/i, "Monthly reporting must expose a stable month key.");

for (const api of [hubApi, reportsApi]) {
  assert.match(api, /requireWorkspaceCommand/, "Business insight APIs must use the authenticated workspace boundary.");
  assert.match(api, /get_business_hub_access/, "Business insight APIs must resolve department permissions.");
  assert.doesNotMatch(api, /export async function (POST|PUT|PATCH|DELETE)/, "Business insight APIs must remain read-only.");
}
assert.match(hubApi, /business_hub_attention/, "Business Hub API must use the attention read model.");
assert.match(hubApi, /business_hub_recent_activity/, "Business Hub API must use the activity read model.");
assert.match(reportsApi, /business_report_monthly_sales/, "Reports API must use the monthly read model.");
assert.match(reportsApi, /business_report_customer_sales/, "Reports API must use the Customer read model.");

assert.doesNotMatch(hubPage, /useBdb/, "Business Hub must not calculate from the legacy shared store.");
assert.doesNotMatch(reportsPage, /useBdb/, "Reports must not calculate from the legacy shared store.");
assert.match(hubPage, /\/api\/business-hub/, "Business Hub must use its authoritative API.");
assert.match(reportsPage, /\/api\/reports/, "Reports must use its authoritative API.");
assert.match(hubPage, /--angle/, "Business Hub must render circular department navigation.");
assert.match(hubStyles, /border-radius: 50%/, "Business Hub navigation must retain circular identity.");
assert.match(hubStyles, /var\(--gold\)/, "Business Hub must retain dark-gold accents.");
assert.match(reportsPage, /selectedCurrency/, "Reports must present one currency at a time.");
assert.match(reportsPage, /Currencies are reported separately|Each currency remains separate/i, "Reports must state the currency boundary.");

assert.match(cache, /localStorage/, "Business insights must preserve an offline snapshot.");
assert.match(cache, /workspaceId/, "Offline snapshots must remain workspace-scoped.");
assert.match(hubPage, /Showing the last trusted Business Hub snapshot while offline/i, "Business Hub must label cached offline data.");
assert.match(reportsPage, /Showing the last trusted Reporting snapshot while offline/i, "Reports must label cached offline data.");

console.log("Business Hub and Reporting architecture contract passed.");
