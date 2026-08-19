import { Buffer } from "node:buffer";
import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const STATUSES = new Set(["posted", "reversed"]);
const METHODS = new Set(["cash", "card", "bank_transfer", "cheque", "other"]);
const ALLOCATION_STATES = new Set(["any", "unallocated", "allocated"]);

type Cursor = { receivedAt: string; id: string };
type PaymentRow = {
  id: string;
  reference: string;
  customer_id: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string;
  currency: string;
  amount: number;
  payment_method: string;
  external_reference: string | null;
  received_at: string;
  status: string;
  allocated_amount: number;
  unallocated_amount: number;
};

function uuid(value: string | null, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  return result;
}

function safeSearch(value: string | null) {
  return String(value ?? "").trim().slice(0, 100).replace(/[^\p{L}\p{N}\s./-]/gu, " ").replace(/\s+/g, " ").trim();
}

function pageSize(value: string | null) {
  const parsed = Number(value ?? 50);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 25), 100) : 50;
}

function encodeCursor(row: PaymentRow) {
  return Buffer.from(JSON.stringify({ receivedAt: row.received_at, id: row.id } satisfies Cursor)).toString("base64url");
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (!parsed.receivedAt || Number.isNaN(Date.parse(parsed.receivedAt)) || !parsed.id || !UUID_PATTERN.test(parsed.id)) throw new Error("invalid");
    return { receivedAt: new Date(parsed.receivedAt).toISOString(), id: parsed.id };
  } catch {
    throw new CommandError("INVALID_ACCOUNTS_CURSOR", "Payment page cursor is invalid.");
  }
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
    const method = String(url.searchParams.get("method") ?? "all").trim();
    const allocation = String(url.searchParams.get("allocation") ?? "any").trim();
    if (status !== "all" && !STATUSES.has(status)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Payment status filter is invalid.");
    if (method !== "all" && !METHODS.has(method)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Payment method filter is invalid.");
    if (!ALLOCATION_STATES.has(allocation)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Payment allocation filter is invalid.");

    let query = supabase
      .from("payment_account_balances")
      .select("id,reference,customer_id,customer_code_snapshot,customer_name_snapshot,currency,amount,payment_method,external_reference,received_at,status,allocated_amount,unallocated_amount")
      .eq("workspace_id", workspaceId)
      .order("received_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (q) {
      const pattern = `%${q}%`;
      query = query.or(`reference.ilike.${pattern},customer_name_snapshot.ilike.${pattern},external_reference.ilike.${pattern}`);
    }
    if (status !== "all") query = query.eq("status", status);
    if (method !== "all") query = query.eq("payment_method", method);
    if (allocation === "unallocated") query = query.gt("unallocated_amount", 0);
    if (allocation === "allocated") query = query.eq("unallocated_amount", 0);
    if (cursor) query = query.or(`received_at.lt.${cursor.receivedAt},and(received_at.eq.${cursor.receivedAt},id.lt.${cursor.id})`);

    const result = await query;
    if (result.error) throw result.error;
    const fetched = (result.data ?? []) as PaymentRow[];
    const hasMore = fetched.length > limit;
    const rows = hasMore ? fetched.slice(0, limit) : fetched;
    const last = rows.at(-1);

    return { workspaceId, rows, pageSize: limit, hasMore, nextCursor: hasMore && last ? encodeCursor(last) : null };
  });
}
