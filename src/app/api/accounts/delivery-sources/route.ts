import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_DELIVERY_SOURCE", "Workspace is invalid.");
  return result;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"));
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [invoiceResult, saleResult, customerResult] = await Promise.all([
      supabase
        .from("invoice_account_balances")
        .select("id,number,customer_id,customer_name_snapshot,status,display_status,created_at,invoice_lines(id,line_number,product_id,code_snapshot,description_snapshot,quantity)")
        .eq("workspace_id", workspaceId)
        .not("status", "in", '(draft,void)')
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("sales")
        .select("id,reference,customer_id,status,created_at,sale_lines(id,line_number,product_id,code_snapshot,description_snapshot,quantity)")
        .eq("workspace_id", workspaceId)
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("customers")
        .select("id,code,name,company,email,phone,address,vat_number,version,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name"),
    ]);
    const failed = [invoiceResult, saleResult, customerResult].find((result) => result.error);
    if (failed?.error) throw failed.error;

    return {
      workspaceId,
      invoices: invoiceResult.data ?? [],
      sales: saleResult.data ?? [],
      customers: customerResult.data ?? [],
    };
  });
}
