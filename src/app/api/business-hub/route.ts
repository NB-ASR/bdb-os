import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_BUSINESS_HUB_INPUT", `${field} is invalid.`);
  return result;
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function currencyList(rows: Array<Record<string, unknown>>, field: string, countField?: string) {
  return rows
    .filter((row) => number(row[field]) !== 0 || (countField ? number(row[countField]) !== 0 : false))
    .map((row) => ({ currency: String(row.currency), amount: number(row[field]), count: countField ? number(row[countField]) : 0 }));
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const context = await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const accessResult = await supabase.rpc("get_business_hub_access", { target_workspace_id: workspaceId });
    if (accessResult.error) throw accessResult.error;
    const accessRows = (accessResult.data ?? []) as Array<{ feature_key: string; can_view: boolean; can_create: boolean }>;
    const access = Object.fromEntries(accessRows.map((item) => [item.feature_key, {
      view: Boolean(item.can_view),
      create: Boolean(item.can_create),
    }])) as Record<string, { view: boolean; create: boolean }>;

    if (!access.overview?.view) throw new CommandError("BUSINESS_HUB_FORBIDDEN", "The Business Hub is not available.", 403);

    const [operationalResult, currencyResult, attentionResult, activityResult] = await Promise.all([
      supabase.from("business_hub_operational_metrics").select("*").eq("workspace_id", workspaceId).maybeSingle(),
      supabase.from("business_hub_currency_metrics").select("*").eq("workspace_id", workspaceId).order("currency"),
      supabase.from("business_hub_attention").select("*").eq("workspace_id", workspaceId).order("priority", { ascending: false }).order("occurred_at", { ascending: false }).limit(50),
      supabase.from("business_hub_recent_activity").select("*").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(50),
    ]);
    for (const result of [operationalResult, currencyResult, attentionResult, activityResult]) {
      if (result.error) throw result.error;
    }

    const operational = (operationalResult.data ?? {}) as Record<string, unknown>;
    const currencies = ((currencyResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      completed_sale_count: number(row.completed_sale_count),
      completed_sale_amount: number(row.completed_sale_amount),
      issued_invoice_count: number(row.issued_invoice_count),
      open_invoice_count: number(row.open_invoice_count),
      overdue_invoice_count: number(row.overdue_invoice_count),
      issued_invoice_amount: number(row.issued_invoice_amount),
      outstanding_invoice_amount: number(row.outstanding_invoice_amount),
      overdue_invoice_amount: number(row.overdue_invoice_amount),
      posted_payment_count: number(row.posted_payment_count),
      received_payment_amount: number(row.received_payment_amount),
      unallocated_payment_amount: number(row.unallocated_payment_amount),
      bank_transaction_count: number(row.bank_transaction_count),
      unreconciled_transaction_count: number(row.unreconciled_transaction_count),
      unreconciled_transaction_amount: number(row.unreconciled_transaction_amount),
      open_supplier_payable_count: number(row.open_supplier_payable_count),
      outstanding_supplier_payable_amount: number(row.outstanding_supplier_payable_amount),
    }));

    const departmentAccess = (department: string) => Boolean(access[department]?.view);
    const attention = ((attentionResult.data ?? []) as Array<Record<string, unknown>>)
      .filter((item) => departmentAccess(String(item.department)))
      .slice(0, 8)
      .map((item) => ({ ...item, priority: number(item.priority), amount: item.amount === null ? null : number(item.amount) }));
    const activity = ((activityResult.data ?? []) as Array<Record<string, unknown>>)
      .filter((item) => departmentAccess(String(item.department)) || String(item.department) === "overview")
      .slice(0, 12);

    const accountAmounts = currencyList(currencies, "outstanding_invoice_amount", "open_invoice_count");
    const saleAmounts = currencyList(currencies, "completed_sale_amount", "completed_sale_count");
    const bankAmounts = currencyList(currencies, "unreconciled_transaction_amount", "unreconciled_transaction_count");

    const departments = [
      {
        key: "customers", name: "Customers", href: "/customers", visible: departmentAccess("customers"),
        value: number(operational.customer_count), label: "active customers",
        detail: `${number(operational.new_customer_count_30d)} new in 30 days`, attention: 0,
      },
      {
        key: "calendar", name: "Calendar", href: "/calendar", visible: departmentAccess("calendar"),
        value: number(operational.today_appointment_count), label: "appointments today",
        detail: `${number(operational.upcoming_appointment_count)} upcoming`, attention: number(operational.pending_today_appointment_count),
      },
      {
        key: "sales", name: "Sales", href: "/sales", visible: departmentAccess("sales"),
        value: number(operational.open_sale_draft_count), label: "open sale drafts",
        detail: saleAmounts, attention: number(operational.open_sale_draft_count),
      },
      {
        key: "accounts", name: "Accounts", href: "/accounts", visible: departmentAccess("accounts"),
        value: number(operational.open_invoice_count), label: "open invoices",
        detail: accountAmounts, attention: number(operational.overdue_invoice_count) + number(operational.unallocated_payment_count),
      },
      {
        key: "communications", name: "Comms", href: "/communications", visible: departmentAccess("communications"),
        value: number(operational.unread_message_count), label: "unread messages",
        detail: `${number(operational.draft_review_count)} drafts need review`, attention: number(operational.unread_message_count) + number(operational.draft_review_count),
      },
      {
        key: "documents", name: "Documents", href: "/documents", visible: departmentAccess("documents"),
        value: number(operational.active_document_count), label: "active files",
        detail: `${number(operational.recent_document_count)} added this week`, attention: 0,
      },
      {
        key: "banking", name: "Banking", href: "/banking", visible: departmentAccess("banking"),
        value: number(operational.unreconciled_transaction_count), label: "unreconciled",
        detail: bankAmounts, attention: number(operational.unreconciled_transaction_count),
      },
      {
        key: "inventory", name: "Stock", href: "/inventory", visible: departmentAccess("inventory"),
        value: number(operational.low_stock_product_count), label: "low-stock products",
        detail: `${number(operational.out_of_stock_product_count)} out of stock`, attention: number(operational.low_stock_product_count),
      },
    ].filter((department) => department.visible);

    const quickActions = [
      { key: "customer", label: "Add Customer", href: "/customers?create=1", allowed: access.customers?.create },
      { key: "appointment", label: "Create Appointment", href: "/calendar?create=1", allowed: access.calendar?.create },
      { key: "sale", label: "Record Sale", href: "/sales?create=1", allowed: access.sales?.create },
      { key: "invoice", label: "Create Invoice", href: "/accounts?tab=invoices&create=1", allowed: access.accounts?.create },
      { key: "communication", label: "Record Communication", href: "/communications?create=1", allowed: access.communications?.create },
    ].filter((action) => action.allowed);

    return {
      workspaceId,
      workspaceName: String(operational.workspace_name ?? "Business"),
      generatedAt: String(operational.generated_at ?? new Date().toISOString()),
      cached: false,
      supportReadOnly: false,
      access,
      operational: Object.fromEntries(Object.entries(operational).map(([key, value]) => [key, typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value) ? number(value) : value])),
      currencies,
      departments,
      attention,
      activity,
      quickActions,
    };
  });
}
