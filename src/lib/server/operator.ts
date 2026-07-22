import { CommandError } from "@/lib/server/command";
import { createClient } from "@/lib/supabase/server";
import { operatorWorkflowCatalog, type OperatorRun } from "@/lib/operator";
import type { SectorWorkflowKey } from "@/lib/sector-packs";

type Row = Record<string, unknown>;

export type VerifiedOperatorPlan = {
  workflowKey: SectorWorkflowKey;
  sourceType: OperatorRun["sourceType"];
  sourceId: string;
  riskLevel: OperatorRun["riskLevel"];
  estimatedMinutesSaved: number;
  plannedAction: Record<string, unknown>;
};

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function loadCustomer(workspaceId: string, customerId: string) {
  const supabase = await createClient();
  if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  const result = await supabase
    .from("customers")
    .select("id,name,email,phone,company")
    .eq("workspace_id", workspaceId)
    .eq("id", customerId)
    .maybeSingle();
  if (result.error) throw result.error;
  if (!result.data) throw new CommandError("CUSTOMER_NOT_FOUND", "The connected customer is unavailable.", 404);
  return result.data as Row;
}

export async function buildVerifiedOperatorPlan(input: {
  workspaceId: string;
  workflowKey: SectorWorkflowKey;
  sourceType: OperatorRun["sourceType"];
  sourceId: string;
}): Promise<VerifiedOperatorPlan> {
  const supabase = await createClient();
  if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

  const catalog = operatorWorkflowCatalog[input.workflowKey];
  if (!catalog) throw new CommandError("WORKFLOW_UNSUPPORTED", "This operator workflow is not supported.");
  if (!input.sourceId || input.sourceId.length > 160) {
    throw new CommandError("SOURCE_INVALID", "A valid source record is required.");
  }

  if (input.sourceType === "booking" && input.workflowKey === "appointment-reminders") {
    const result = await supabase
      .from("bookings")
      .select("id,customer_id,title,booking_date,booking_time,duration_minutes,status")
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.sourceId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new CommandError("BOOKING_NOT_FOUND", "The appointment is unavailable.", 404);
    const booking = result.data as Row;
    const status = stringValue(booking.status);
    if (status === "completed") throw new CommandError("BOOKING_COMPLETE", "Completed appointments cannot be reminded.");
    const startsAt = new Date(`${stringValue(booking.booking_date)}T${stringValue(booking.booking_time).slice(0, 8)}`);
    if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      throw new CommandError("BOOKING_PASSED", "The appointment start time has already passed.");
    }
    const customer = await loadCustomer(input.workspaceId, stringValue(booking.customer_id));
    return {
      workflowKey: input.workflowKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      riskLevel: status === "confirmed" ? "low" : "medium",
      estimatedMinutesSaved: catalog.defaultMinutes,
      plannedAction: {
        action: "send_appointment_reminder",
        title: `Appointment reminder for ${stringValue(customer.name)}`,
        detail: `${stringValue(booking.title)} · ${stringValue(booking.booking_date)} at ${stringValue(booking.booking_time).slice(0, 5)}`,
        recordLabel: `${stringValue(booking.booking_date)} · ${stringValue(booking.booking_time).slice(0, 5)}`,
        booking: {
          id: input.sourceId,
          title: stringValue(booking.title),
          date: stringValue(booking.booking_date),
          time: stringValue(booking.booking_time).slice(0, 5),
          durationMinutes: numberValue(booking.duration_minutes),
          status,
        },
        recipient: {
          customerId: stringValue(customer.id),
          name: stringValue(customer.name),
          email: stringValue(customer.email),
          phone: stringValue(customer.phone),
        },
      },
    };
  }

  if (input.sourceType === "invoice" && input.workflowKey === "overdue-invoice-follow-up") {
    const result = await supabase
      .from("invoices")
      .select("id,customer_id,number,due_at,amount,status,description")
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.sourceId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new CommandError("INVOICE_NOT_FOUND", "The invoice is unavailable.", 404);
    const invoice = result.data as Row;
    if (stringValue(invoice.status) !== "overdue") {
      throw new CommandError("INVOICE_NOT_OVERDUE", "Only a verified overdue invoice can enter this workflow.");
    }
    const customer = await loadCustomer(input.workspaceId, stringValue(invoice.customer_id));
    return {
      workflowKey: input.workflowKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      riskLevel: "high",
      estimatedMinutesSaved: catalog.defaultMinutes,
      plannedAction: {
        action: "prepare_overdue_invoice_follow_up",
        title: `Overdue invoice follow-up for ${stringValue(customer.name)}`,
        detail: `${stringValue(invoice.number)} · due ${stringValue(invoice.due_at)}`,
        recordLabel: stringValue(invoice.number),
        cashProtected: numberValue(invoice.amount),
        invoice: {
          id: input.sourceId,
          number: stringValue(invoice.number),
          dueAt: stringValue(invoice.due_at),
          amount: numberValue(invoice.amount),
          description: stringValue(invoice.description),
          status: stringValue(invoice.status),
        },
        recipient: {
          customerId: stringValue(customer.id),
          name: stringValue(customer.name),
          email: stringValue(customer.email),
          phone: stringValue(customer.phone),
        },
      },
    };
  }

  if (input.sourceType === "message" && input.workflowKey === "new-enquiry-triage") {
    const result = await supabase
      .from("messages")
      .select("id,customer_id,channel,subject,preview,occurred_at,unread,status")
      .eq("workspace_id", input.workspaceId)
      .eq("id", input.sourceId)
      .maybeSingle();
    if (result.error) throw result.error;
    if (!result.data) throw new CommandError("MESSAGE_NOT_FOUND", "The message is unavailable.", 404);
    const message = result.data as Row;
    if (!Boolean(message.unread) && !["open", "approval"].includes(stringValue(message.status))) {
      throw new CommandError("MESSAGE_HANDLED", "This message is already recorded as handled.");
    }
    const customer = await loadCustomer(input.workspaceId, stringValue(message.customer_id));
    return {
      workflowKey: input.workflowKey,
      sourceType: input.sourceType,
      sourceId: input.sourceId,
      riskLevel: stringValue(message.status) === "approval" ? "high" : "medium",
      estimatedMinutesSaved: catalog.defaultMinutes,
      plannedAction: {
        action: "prepare_enquiry_response",
        title: `Triage enquiry from ${stringValue(customer.name)}`,
        detail: `${stringValue(message.channel)} · ${stringValue(message.subject)}`,
        recordLabel: stringValue(message.subject),
        message: {
          id: input.sourceId,
          channel: stringValue(message.channel),
          subject: stringValue(message.subject),
          preview: stringValue(message.preview),
          occurredAt: stringValue(message.occurred_at),
          status: stringValue(message.status),
        },
        recipient: {
          customerId: stringValue(customer.id),
          name: stringValue(customer.name),
          email: stringValue(customer.email),
          phone: stringValue(customer.phone),
        },
      },
    };
  }

  throw new CommandError(
    "SOURCE_WORKFLOW_MISMATCH",
    "The selected record does not match this published operator workflow.",
  );
}
