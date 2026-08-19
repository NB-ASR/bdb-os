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

type Allocation = { payment_id: string; amount_delta: number };
type Payment = {
  id: string;
  reference: string;
  customer_name_snapshot: string;
  currency: string;
  amount: number;
  payment_method: string;
  external_reference: string | null;
  received_at: string;
  status: string;
};

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const { id: rawId } = await params;
    const invoiceId = uuid(rawId, "Invoice");
    await requireWorkspaceCommand(request, workspaceId);

    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const invoiceResult = await supabase
      .from("invoice_account_balances")
      .select("*,invoice_lines(*)")
      .eq("workspace_id", workspaceId)
      .eq("id", invoiceId)
      .maybeSingle();
    if (invoiceResult.error) throw invoiceResult.error;
    if (!invoiceResult.data) throw new CommandError("ACCOUNTS_NOT_FOUND", "Invoice could not be found.", 404);

    const invoice = invoiceResult.data;
    const [customerResult, creditsResult, allocationsResult, notesResult, deliveriesResult] = await Promise.all([
      supabase
        .from("customers")
        .select("id,code,name,company,email,phone,address,vat_number")
        .eq("workspace_id", workspaceId)
        .eq("id", String(invoice.customer_id))
        .maybeSingle(),
      supabase
        .from("credit_notes")
        .select("id,number,reason,status,issued_at,created_at,currency,total_amount,sales_order_reference")
        .eq("workspace_id", workspaceId)
        .eq("invoice_id", invoiceId)
        .order("created_at", { ascending: false }),
      supabase
        .from("payment_allocations")
        .select("payment_id,amount_delta")
        .eq("workspace_id", workspaceId)
        .eq("invoice_id", invoiceId),
      supabase
        .from("business_document_notes")
        .select("id,note,created_by,created_at")
        .eq("workspace_id", workspaceId)
        .eq("document_type", "invoice")
        .eq("document_id", invoiceId)
        .order("created_at", { ascending: false }),
      supabase
        .from("delivery_notes")
        .select("id,number,delivery_date,status,delivery_address,created_at")
        .eq("workspace_id", workspaceId)
        .eq("source_invoice_id", invoiceId)
        .order("created_at", { ascending: false }),
    ]);

    const failed = [customerResult, creditsResult, allocationsResult, notesResult, deliveriesResult].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const allocations = (allocationsResult.data ?? []) as Allocation[];
    const paymentIds = [...new Set(allocations.map((allocation) => allocation.payment_id))];
    let payments: Payment[] = [];
    if (paymentIds.length) {
      const paymentsResult = await supabase
        .from("payment_account_balances")
        .select("id,reference,customer_name_snapshot,currency,amount,payment_method,external_reference,received_at,status")
        .eq("workspace_id", workspaceId)
        .in("id", paymentIds)
        .order("received_at", { ascending: false });
      if (paymentsResult.error) throw paymentsResult.error;
      payments = (paymentsResult.data ?? []) as Payment[];
    }

    const linkedPayments = payments
      .map((payment) => ({
        ...payment,
        allocated_to_invoice: allocations
          .filter((allocation) => allocation.payment_id === payment.id)
          .reduce((total, allocation) => total + Number(allocation.amount_delta), 0),
      }))
      .filter((payment) => Math.abs(payment.allocated_to_invoice) > 0.00005);

    return {
      workspaceId,
      invoice: {
        ...invoice,
        invoice_lines: [...(invoice.invoice_lines ?? [])].sort((left, right) => Number(left.line_number) - Number(right.line_number)),
      },
      customer: customerResult.data ?? null,
      creditNotes: creditsResult.data ?? [],
      payments: linkedPayments,
      deliveryNotes: deliveriesResult.data ?? [],
      notes: notesResult.data ?? [],
    };
  });
}
