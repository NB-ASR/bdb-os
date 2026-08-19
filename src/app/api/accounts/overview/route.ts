import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function workspaceId(value: string | null) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Workspace is invalid.");
  return result;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const id = workspaceId(new URL(request.url).searchParams.get("workspaceId"));
    await requireWorkspaceCommand(request, id);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [summaryResult, documentsResult] = await Promise.all([
      supabase
        .from("accounts_workspace_summary")
        .select("workspace_id,currency,invoice_count,open_invoice_count,overdue_invoice_count,credited_invoice_count,outstanding_amount,customer_credit_amount,unallocated_payment_count,unallocated_payment_amount")
        .eq("workspace_id", id)
        .maybeSingle(),
      supabase
        .from("business_document_index")
        .select("document_type,id,number,customer_name,document_date,status,currency,total_amount,balance_amount")
        .eq("workspace_id", id)
        .order("document_date", { ascending: false })
        .order("number", { ascending: false })
        .limit(8),
    ]);

    if (summaryResult.error) throw summaryResult.error;
    if (documentsResult.error) throw documentsResult.error;

    return {
      workspaceId: id,
      summary: summaryResult.data ?? {
        workspace_id: id,
        currency: "EUR",
        invoice_count: 0,
        open_invoice_count: 0,
        overdue_invoice_count: 0,
        credited_invoice_count: 0,
        outstanding_amount: 0,
        customer_credit_amount: 0,
        unallocated_payment_count: 0,
        unallocated_payment_amount: 0,
      },
      recentDocuments: documentsResult.data ?? [],
    };
  });
}
