import { Buffer } from "node:buffer";
import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["draft", "issued"]);
type Cursor = { createdAt: string; id: string };
type Row = { id: string; number: string; source_invoice_id: string | null; source_sale_id: string | null; customer_id: string; customer_name_snapshot: string; delivery_address: string | null; delivery_date: string; status: string; created_at: string };

function uuid(value: string | null, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  return result;
}
function pageSize(value: string | null) { const parsed = Number(value ?? 50); return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 25), 100) : 50; }
function safeSearch(value: string | null) { return String(value ?? "").trim().slice(0, 100).replace(/[^\p{L}\p{N}\s./-]/gu, " ").replace(/\s+/g, " ").trim(); }
function encodeCursor(row: Row) { return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id } satisfies Cursor)).toString("base64url"); }
function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (!parsed.createdAt || Number.isNaN(Date.parse(parsed.createdAt)) || !parsed.id || !UUID_PATTERN.test(parsed.id)) throw new Error("invalid");
    return { createdAt: new Date(parsed.createdAt).toISOString(), id: parsed.id };
  } catch { throw new CommandError("INVALID_ACCOUNTS_CURSOR", "Delivery Note page cursor is invalid."); }
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const limit = pageSize(url.searchParams.get("pageSize"));
    const cursor = decodeCursor(url.searchParams.get("cursor"));
    const q = safeSearch(url.searchParams.get("q"));
    const status = String(url.searchParams.get("status") ?? "all").trim();
    if (status !== "all" && !STATUSES.has(status)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Delivery Note status filter is invalid.");

    let query = supabase.from("delivery_notes")
      .select("id,number,source_invoice_id,source_sale_id,customer_id,customer_name_snapshot,delivery_address,delivery_date,status,created_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false }).order("id", { ascending: false }).limit(limit + 1);
    if (q) { const pattern = `%${q}%`; query = query.or(`number.ilike.${pattern},customer_name_snapshot.ilike.${pattern},delivery_address.ilike.${pattern}`); }
    if (status !== "all") query = query.eq("status", status);
    if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
    const result = await query;
    if (result.error) throw result.error;
    const fetched = (result.data ?? []) as Row[];
    const hasMore = fetched.length > limit;
    const rows = hasMore ? fetched.slice(0, limit) : fetched;
    const last = rows.at(-1);
    return { workspaceId, rows, pageSize: limit, hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null };
  });
}
