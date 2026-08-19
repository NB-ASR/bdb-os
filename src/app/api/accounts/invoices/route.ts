import { Buffer } from "node:buffer";
import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DISPLAY_STATUSES = new Set(["sent", "overdue", "paid", "cancelled", "draft", "void"]);
const PAYMENT_STATUSES = new Set(["unpaid", "partially_paid", "paid", "cancelled", "draft", "void"]);
const CREDIT_STATES = new Set(["any", "with", "without"]);

type Cursor = { date: string; id: string };

type InvoiceRegisterRow = {
  id: string;
  number: string;
  customer_id: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string;
  issued_at: string;
  due_at: string | null;
  description: string;
  currency: string;
  total_amount: number;
  credited_amount: number;
  allocated_amount: number;
  outstanding_amount: number;
  display_status: string;
  payment_status: string;
  sales_order_reference: string | null;
};

function uuid(value: string | null, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  return result;
}

function optionalDate(value: string | null, field: string) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (!DATE_PATTERN.test(result) || Number.isNaN(Date.parse(`${result}T00:00:00Z`))) {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  }
  return result;
}

function pageSize(value: string | null) {
  const parsed = Number(value ?? 50);
  if (!Number.isInteger(parsed)) return 50;
  return Math.min(Math.max(parsed, 25), 100);
}

function searchTerm(value: string | null) {
  const raw = String(value ?? "").trim().slice(0, 100);
  return raw
    .replace(/[^\p{L}\p{N}\s./-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function encodeCursor(row: Pick<InvoiceRegisterRow, "issued_at" | "id">) {
  return Buffer.from(JSON.stringify({ date: row.issued_at, id: row.id } satisfies Cursor)).toString("base64url");
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<Cursor>;
    if (!decoded.date || !DATE_PATTERN.test(decoded.date) || !decoded.id || !UUID_PATTERN.test(decoded.id)) throw new Error("invalid");
    return { date: decoded.date, id: decoded.id };
  } catch {
    throw new CommandError("INVALID_ACCOUNTS_CURSOR", "Invoice page cursor is invalid.");
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
    const queryText = searchTerm(url.searchParams.get("q"));
    const dateFrom = optionalDate(url.searchParams.get("dateFrom"), "From date");
    const dateTo = optionalDate(url.searchParams.get("dateTo"), "To date");
    const status = String(url.searchParams.get("status") ?? "all").trim();
    const paymentStatus = String(url.searchParams.get("paymentStatus") ?? "all").trim();
    const creditState = String(url.searchParams.get("credit") ?? "any").trim();

    if (status !== "all" && !DISPLAY_STATUSES.has(status)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Invoice status filter is invalid.");
    if (paymentStatus !== "all" && !PAYMENT_STATUSES.has(paymentStatus)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Payment status filter is invalid.");
    if (!CREDIT_STATES.has(creditState)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Credit filter is invalid.");

    let query = supabase
      .from("invoice_account_balances")
      .select("id,number,customer_id,customer_code_snapshot,customer_name_snapshot,issued_at,due_at,description,currency,total_amount,credited_amount,allocated_amount,outstanding_amount,display_status,payment_status,sales_order_reference")
      .eq("workspace_id", workspaceId)
      .order("issued_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (queryText) {
      const pattern = `%${queryText}%`;
      query = query.or(`number.ilike.${pattern},customer_name_snapshot.ilike.${pattern},sales_order_reference.ilike.${pattern}`);
    }
    if (dateFrom) query = query.gte("issued_at", dateFrom);
    if (dateTo) query = query.lte("issued_at", dateTo);
    if (status !== "all") query = query.eq("display_status", status);
    if (paymentStatus !== "all") query = query.eq("payment_status", paymentStatus);
    if (creditState === "with") query = query.gt("credited_amount", 0);
    if (creditState === "without") query = query.eq("credited_amount", 0);
    if (cursor) {
      query = query.or(`issued_at.lt.${cursor.date},and(issued_at.eq.${cursor.date},id.lt.${cursor.id})`);
    }

    const result = await query;
    if (result.error) throw result.error;

    const fetched = (result.data ?? []) as InvoiceRegisterRow[];
    const hasMore = fetched.length > limit;
    const rows = hasMore ? fetched.slice(0, limit) : fetched;
    const last = rows.at(-1);

    return {
      workspaceId,
      rows,
      pageSize: limit,
      hasMore,
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  });
}
