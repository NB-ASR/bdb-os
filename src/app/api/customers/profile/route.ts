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
  data: unknown;
  error: { message: string } | null;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_CUSTOMER_PROFILE_INPUT", `${field} is invalid.`);
  }
  return result;
}

function emptyResult(data: unknown = []) {
  return Promise.resolve({ data, error: null } satisfies QueryResult);
}

function throwQueryError(results: QueryResult[]) {
  const failed = results.find((result) => result.error);
  if (failed?.error) throw failed.error;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const customerId = uuid(url.searchParams.get("customerId"), "Customer");
    await requireWorkspaceCommand(request, workspaceId);

    const supabase = await createClient();
    if (!supabase) {
      throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    }

    const [customerResult, accessResult] = await Promise.all([
      supabase
        .from("customers")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", customerId)
        .maybeSingle(),
      supabase.rpc("get_customer_360_access", { target_workspace_id: workspaceId }),
    ]);

    if (customerResult.error) throw customerResult.error;
    if (!customerResult.data) {
      throw new CommandError("CUSTOMER_NOT_FOUND", "The Customer could not be found.", 404);
    }
    if (accessResult.error) throw accessResult.error;

    const access = Object.fromEntries(
      ((accessResult.data ?? []) as Array<{ feature_key: string; can_view: boolean }>).map((item) => [
        item.feature_key,
        Boolean(item.can_view),
      ]),
    ) as Record<string, boolean>;

    const [
      operationalResult,
      financialResult,
      activityResult,
      notesResult,
      appointmentsResult,
      salesResult,
      invoicesResult,
      paymentsResult,
      documentsResult,
      messagesResult,
    ] = await Promise.all([
      supabase
        .from("customer_360_operational_summary")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("customer_id", customerId)
        .maybeSingle(),
      access.accounts
        ? supabase
          .from("customer_360_financial_summary")
          .select("*")
          .eq("workspace_id", workspaceId)
          .eq("customer_id", customerId)
          .order("currency")
        : emptyResult(),
      supabase
        .from("customer_360_activity")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("customer_id", customerId)
        .order("occurred_at", { ascending: false })
        .limit(100),
      supabase
        .from("customer_note_status")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("customer_id", customerId)
        .order("occurred_at", { ascending: false })
        .limit(100),
      access.calendar
        ? supabase
          .from("bookings")
          .select("id,reference,title,booking_date,booking_time,duration_minutes,staff_name,status,service_id,staff_user_id,room_name,price_snapshot,vat_rate_snapshot,timezone,notes,cancellation_reason,created_at,updated_at,completed_at,cancelled_at")
          .eq("workspace_id", workspaceId)
          .eq("customer_id", customerId)
          .order("booking_date", { ascending: false })
          .order("booking_time", { ascending: false })
          .limit(50)
        : emptyResult(),
      access.sales
        ? supabase
          .from("sales")
          .select("id,reference,channel,currency,total_amount,settlement_status,notes,status,occurred_at,completed_at,reversed_at,reversal_reason")
          .eq("workspace_id", workspaceId)
          .eq("customer_id", customerId)
          .order("occurred_at", { ascending: false })
          .limit(50)
        : emptyResult(),
      access.accounts
        ? supabase
          .from("invoice_account_balances")
          .select("id,number,source_sale_id,issued_at,due_at,description,currency,total_amount,status,display_status,payment_status,allocated_amount,outstanding_amount,notes,created_at,sent_at,voided_at,void_reason")
          .eq("workspace_id", workspaceId)
          .eq("customer_id", customerId)
          .order("created_at", { ascending: false })
          .limit(50)
        : emptyResult(),
      access.accounts
        ? supabase
          .from("payment_account_balances")
          .select("id,reference,currency,amount,payment_method,external_reference,notes,received_at,status,reversed_at,reversal_reason,allocated_amount,unallocated_amount,created_at")
          .eq("workspace_id", workspaceId)
          .eq("customer_id", customerId)
          .order("received_at", { ascending: false })
          .limit(50)
        : emptyResult(),
      access.documents
        ? supabase
          .from("documents")
          .select("id,name,document_type,size_label,storage_path,linked_to,uploaded_at,created_at")
          .eq("workspace_id", workspaceId)
          .eq("customer_id", customerId)
          .order("uploaded_at", { ascending: false })
          .limit(50)
        : emptyResult(),
      access.communications
        ? supabase
          .from("messages")
          .select("id,channel,subject,preview,occurred_at,unread,status,created_at,updated_at")
          .eq("workspace_id", workspaceId)
          .eq("customer_id", customerId)
          .order("occurred_at", { ascending: false })
          .limit(50)
        : emptyResult(),
    ]);

    throwQueryError([
      operationalResult,
      financialResult,
      activityResult,
      notesResult,
      appointmentsResult,
      salesResult,
      invoicesResult,
      paymentsResult,
      documentsResult,
      messagesResult,
    ] as QueryResult[]);

    const noteActorIds = Array.from(new Set(
      ((notesResult.data ?? []) as Array<{ actor_user_id?: string | null; voided_by?: string | null }>).flatMap((note) => [
        note.actor_user_id,
        note.voided_by,
      ]).filter((value): value is string => Boolean(value)),
    ));

    let actors: Record<string, string> = {};
    if (noteActorIds.length) {
      const actorResult = await supabase
        .from("profiles")
        .select("id,full_name")
        .in("id", noteActorIds);
      if (!actorResult.error) {
        actors = Object.fromEntries(
          (actorResult.data ?? []).map((profile) => [profile.id, profile.full_name || "Team member"]),
        );
      }
    }

    return {
      workspaceId,
      customer: customerResult.data,
      access,
      operational: operationalResult.data ?? null,
      financial: financialResult.data ?? [],
      activity: activityResult.data ?? [],
      notes: notesResult.data ?? [],
      actors,
      appointments: appointmentsResult.data ?? [],
      sales: salesResult.data ?? [],
      invoices: invoicesResult.data ?? [],
      payments: paymentsResult.data ?? [],
      documents: documentsResult.data ?? [],
      messages: messagesResult.data ?? [],
    };
  });
}
