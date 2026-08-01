import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type QueryResult = {
  data: Array<Record<string, unknown>> | null;
  error: { message: string } | null;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_DOCUMENT_TARGET_INPUT", `${field} is invalid.`);
  }
  return result;
}

function emptyResult(): Promise<QueryResult> {
  return Promise.resolve({ data: [], error: null });
}

function throwQueryError(results: QueryResult[]) {
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const accessResult = await supabase.rpc("get_customer_360_access", {
      target_workspace_id: workspaceId,
    });
    if (accessResult.error) throw accessResult.error;
    const access = Object.fromEntries(
      ((accessResult.data ?? []) as Array<{ feature_key: string; can_view: boolean }>).map((item) => [
        item.feature_key,
        Boolean(item.can_view),
      ]),
    ) as Record<string, boolean>;
    if (!access.documents) {
      throw new CommandError("DOCUMENTS_FORBIDDEN", "You do not have permission to view Documents.", 403);
    }

    const [customers, appointments, sales, invoices, payments, communications] = await Promise.all([
      access.customers
        ? supabase
          .from("customers")
          .select("id,code,name,company,status")
          .eq("workspace_id", workspaceId)
          .order("name")
          .limit(200)
        : emptyResult(),
      access.calendar
        ? supabase
          .from("bookings")
          .select("id,reference,title,customer_name_snapshot,booking_date,booking_time,status")
          .eq("workspace_id", workspaceId)
          .order("booking_date", { ascending: false })
          .order("booking_time", { ascending: false })
          .limit(100)
        : emptyResult(),
      access.sales
        ? supabase
          .from("sales")
          .select("id,reference,customer_id,currency,total_amount,status,occurred_at")
          .eq("workspace_id", workspaceId)
          .order("occurred_at", { ascending: false })
          .limit(100)
        : emptyResult(),
      access.accounts
        ? supabase
          .from("invoices")
          .select("id,number,customer_name_snapshot,currency,total_amount,status,issued_at")
          .eq("workspace_id", workspaceId)
          .order("issued_at", { ascending: false })
          .limit(100)
        : emptyResult(),
      access.accounts
        ? supabase
          .from("payments")
          .select("id,reference,customer_name_snapshot,currency,amount,status,received_at")
          .eq("workspace_id", workspaceId)
          .order("received_at", { ascending: false })
          .limit(100)
        : emptyResult(),
      access.communications
        ? supabase
          .from("messages")
          .select("id,channel,subject,occurred_at,status")
          .eq("workspace_id", workspaceId)
          .order("occurred_at", { ascending: false })
          .limit(100)
        : emptyResult(),
    ]);

    throwQueryError([
      customers,
      appointments,
      sales,
      invoices,
      payments,
      communications,
    ] as QueryResult[]);

    return {
      access,
      targets: {
        business: [{ id: null, label: "Business", detail: "General business file" }],
        customer: (customers.data ?? []).map((item) => ({
          id: item.id,
          label: `${item.code} · ${item.name}`,
          detail: item.company || item.status,
        })),
        appointment: (appointments.data ?? []).map((item) => ({
          id: item.id,
          label: `${item.reference} · ${item.title}`,
          detail: `${item.customer_name_snapshot ?? "Customer"} · ${item.booking_date} ${String(item.booking_time).slice(0, 5)}`,
        })),
        sale: (sales.data ?? []).map((item) => ({
          id: item.id,
          label: String(item.reference),
          detail: `${item.currency} ${Number(item.total_amount).toFixed(2)} · ${item.status}`,
        })),
        invoice: (invoices.data ?? []).map((item) => ({
          id: item.id,
          label: `${item.number} · ${item.customer_name_snapshot}`,
          detail: `${item.currency} ${Number(item.total_amount).toFixed(2)} · ${item.status}`,
        })),
        customer_payment: (payments.data ?? []).map((item) => ({
          id: item.id,
          label: `${item.reference} · ${item.customer_name_snapshot}`,
          detail: `${item.currency} ${Number(item.amount).toFixed(2)} · ${item.status}`,
        })),
        communication: (communications.data ?? []).map((item) => ({
          id: item.id,
          label: `${item.channel} · ${item.subject}`,
          detail: `${item.status} · ${item.occurred_at}`,
        })),
      },
    };
  });
}
