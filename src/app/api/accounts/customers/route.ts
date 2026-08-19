import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BALANCE_STATES = new Set(["amount_due", "customer_credit", "clear"]);

function uuid(value: string | null, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  return result;
}

function pageNumber(value: string | null) {
  const parsed = Number(value ?? 1);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 100000) : 1;
}

function pageSize(value: string | null) {
  const parsed = Number(value ?? 50);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 25), 100) : 50;
}

function safeSearch(value: string | null) {
  return String(value ?? "").trim().slice(0, 100).replace(/[^\p{L}\p{N}\s./-]/gu, " ").replace(/\s+/g, " ").trim();
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const page = pageNumber(url.searchParams.get("page"));
    const limit = pageSize(url.searchParams.get("pageSize"));
    const q = safeSearch(url.searchParams.get("q"));
    const status = String(url.searchParams.get("status") ?? "all").trim();
    if (status !== "all" && !BALANCE_STATES.has(status)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Customer balance filter is invalid.");

    const from = (page - 1) * limit;
    const to = from + limit;
    let query = supabase
      .from("customer_account_balances")
      .select("customer_id,customer_code,customer_name,company,outstanding_amount,unallocated_credit,net_balance,balance_status")
      .eq("workspace_id", workspaceId)
      .order("customer_name", { ascending: true })
      .order("customer_id", { ascending: true })
      .range(from, to);

    if (q) {
      const pattern = `%${q}%`;
      query = query.or(`customer_name.ilike.${pattern},customer_code.ilike.${pattern},company.ilike.${pattern}`);
    }
    if (status !== "all") query = query.eq("balance_status", status);

    const result = await query;
    if (result.error) throw result.error;
    const fetched = result.data ?? [];
    const hasMore = fetched.length > limit;
    const rows = hasMore ? fetched.slice(0, limit) : fetched;
    return { workspaceId, rows, page, pageSize: limit, hasMore };
  });
}
