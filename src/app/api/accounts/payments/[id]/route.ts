import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  return result;
}

type AllocationRow = {
  id: string;
  payment_id: string;
  invoice_id: string;
  allocation_type: "allocation" | "reversal";
  amount_delta: number;
  reversal_of_id: string | null;
  reason: string | null;
  occurred_at: string;
};

type InvoiceRow = {
  id: string;
  number: string;
  issued_at: string;
  due_at: string | null;
  display_status: string;
  outstanding_amount: number;
  currency: string;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const { id: rawId } = await params;
    const paymentId = uuid(rawId, "Payment");
    await requireWorkspaceCommand(request, workspaceId);

    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const paymentResult = await supabase
      .from("payment_account_balances")
      .select("id,workspace_id,reference,customer_id,customer_code_snapshot,customer_name_snapshot,currency,amount,payment_method,external_reference,notes,received_at,status,version,allocated_amount,unallocated_amount,reversed_at,reversal_reason")
      .eq("workspace_id", workspaceId)
      .eq("id", paymentId)
      .maybeSingle();
    if (paymentResult.error) throw paymentResult.error;
    if (!paymentResult.data) throw new CommandError("ACCOUNTS_NOT_FOUND", "Payment could not be found.", 404);

    const payment = paymentResult.data;
    const [allocationsResult, customerResult, eligibleResult] = await Promise.all([
      supabase
        .from("payment_allocations")
        .select("id,payment_id,invoice_id,allocation_type,amount_delta,reversal_of_id,reason,occurred_at")
        .eq("workspace_id", workspaceId)
        .eq("payment_id", paymentId)
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false }),
      supabase
        .from("customers")
        .select("id,code,name,company,email,phone")
        .eq("workspace_id", workspaceId)
        .eq("id", String(payment.customer_id))
        .maybeSingle(),
      payment.status === "posted"
        ? supabase
          .from("invoice_account_balances")
          .select("id,number,issued_at,due_at,display_status,outstanding_amount,currency")
          .eq("workspace_id", workspaceId)
          .eq("customer_id", String(payment.customer_id))
          .eq("currency", String(payment.currency))
          .gt("outstanding_amount", 0)
          .in("display_status", ["sent", "overdue"])
          .order("due_at", { ascending: true, nullsFirst: false })
          .order("issued_at", { ascending: true })
          .limit(50)
        : Promise.resolve({ data: [], error: null }),
    ]);
    const failed = [allocationsResult, customerResult, eligibleResult].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const allocations = (allocationsResult.data ?? []) as AllocationRow[];
    const invoiceIds = [...new Set(allocations.map((allocation) => allocation.invoice_id))];
    let linkedInvoices: InvoiceRow[] = [];
    if (invoiceIds.length) {
      const linkedResult = await supabase
        .from("invoice_account_balances")
        .select("id,number,issued_at,due_at,display_status,outstanding_amount,currency")
        .eq("workspace_id", workspaceId)
        .in("id", invoiceIds);
      if (linkedResult.error) throw linkedResult.error;
      linkedInvoices = (linkedResult.data ?? []) as InvoiceRow[];
    }

    const invoicesById = new Map(linkedInvoices.map((invoice) => [invoice.id, invoice]));
    const reversedIds = new Set(allocations.flatMap((allocation) => allocation.reversal_of_id ? [allocation.reversal_of_id] : []));

    return {
      workspaceId,
      payment,
      customer: customerResult.data ?? null,
      allocations: allocations.map((allocation) => {
        const invoice = invoicesById.get(allocation.invoice_id);
        return {
          ...allocation,
          reversed: allocation.allocation_type === "allocation" && reversedIds.has(allocation.id),
          invoice_number: invoice?.number ?? "Invoice",
          invoice_status: invoice?.display_status ?? "unavailable",
          invoice_outstanding_amount: Number(invoice?.outstanding_amount ?? 0),
        };
      }),
      eligibleInvoices: (eligibleResult.data ?? []) as InvoiceRow[],
    };
  });
}
