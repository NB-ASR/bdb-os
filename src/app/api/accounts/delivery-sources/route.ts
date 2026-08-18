import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = String(new URL(request.url).searchParams.get("workspaceId") ?? "").trim();
    if (!UUID_PATTERN.test(workspaceId)) throw new CommandError("INVALID_DELIVERY_SOURCE_INPUT", "Workspace is invalid.");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const result = await supabase
      .from("sales")
      .select("id,reference,customer_id,currency,status,total_amount,sale_lines(id,line_number,line_type,product_id,service_id,code_snapshot,description_snapshot,quantity)")
      .eq("workspace_id", workspaceId)
      .eq("status", "completed")
      .not("customer_id", "is", null)
      .order("completed_at", { ascending: false })
      .limit(100);
    if (result.error) throw result.error;
    return {
      sales: (result.data ?? []).map((sale) => ({
        ...sale,
        sale_lines: [...(sale.sale_lines ?? [])].sort((a, b) => Number(a.line_number) - Number(b.line_number)),
      })),
    };
  });
}
