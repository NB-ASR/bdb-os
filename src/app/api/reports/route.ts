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
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_REPORT_INPUT", `${field} is invalid.`);
  return result;
}

function number(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const accessResult = await supabase.rpc("get_business_hub_access", { target_workspace_id: workspaceId });
    if (accessResult.error) throw accessResult.error;
    const access = Object.fromEntries(
      ((accessResult.data ?? []) as Array<{ feature_key: string; can_view: boolean }>).map((item) => [item.feature_key, Boolean(item.can_view)]),
    ) as Record<string, boolean>;
    if (!access.reports) throw new CommandError("REPORTS_FORBIDDEN", "Reports are not available.", 403);

    const [currencyResult, monthlyResult, customerResult, operationalResult] = await Promise.all([
      supabase.from("business_hub_currency_metrics").select("*").eq("workspace_id", workspaceId).order("currency"),
      access.sales
        ? supabase.from("business_report_monthly_sales").select("*").eq("workspace_id", workspaceId).order("month_start", { ascending: true }).order("currency")
        : Promise.resolve({ data: [], error: null }),
      access.sales && access.customers
        ? supabase.from("business_report_customer_sales").select("*").eq("workspace_id", workspaceId).order("completed_sale_amount", { ascending: false }).limit(25)
        : Promise.resolve({ data: [], error: null }),
      supabase.from("business_hub_operational_metrics").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    ]);
    for (const result of [currencyResult, monthlyResult, customerResult, operationalResult]) {
      if (result.error) throw result.error;
    }

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
    const monthly = ((monthlyResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      completed_sale_count: number(row.completed_sale_count),
      completed_sale_amount: number(row.completed_sale_amount),
    }));
    const customers = ((customerResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      ...row,
      completed_sale_count: number(row.completed_sale_count),
      completed_sale_amount: number(row.completed_sale_amount),
    }));

    return {
      workspaceId,
      workspaceName: String((operationalResult.data as Record<string, unknown> | null)?.workspace_name ?? "Business"),
      generatedAt: new Date().toISOString(),
      supportReadOnly: false,
      dataBoundary: "Authoritative BDB OS records only. Currencies are reported separately. Profit and tax are not inferred without verified expense and tax ledgers.",
      access,
      currencies,
      monthly,
      customers,
      operational: operationalResult.data ?? {},
    };
  });
}
