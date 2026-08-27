import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["create", "update", "confirm", "cancel", "complete"]);
const CHANNELS = new Set(["staff", "phone", "walk_in", "online"]);
const INITIAL_STATUSES = new Set(["pending", "confirmed"]);
const CALENDAR_LIMITS = {
  appointments: 2_500,
  customers: 1_000,
  services: 500,
  staff: 250,
  rooms: 250,
  eligibility: 5_000,
} as const;

type AppointmentCommandBody = Record<string, unknown> & {
  workspaceId?: unknown;
  action?: unknown;
  id?: unknown;
  expectedVersion?: unknown;
  customerId?: unknown;
  serviceId?: unknown;
  staffUserId?: unknown;
  bookingDate?: unknown;
  bookingTime?: unknown;
  channel?: unknown;
  roomName?: unknown;
  notes?: unknown;
  initialStatus?: unknown;
  cancellationReason?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_APPOINTMENT_INPUT", `${field} is invalid.`);
  return result;
}

function optionalUuid(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return uuid(value, field);
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) throw new CommandError("INVALID_APPOINTMENT_INPUT", "An Appointment field is too long.");
  return result;
}

function expectedVersion(value: unknown) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new CommandError("INVALID_APPOINTMENT_VERSION", "Refresh the Appointment before changing it.");
  }
  return result;
}

function dateValue(value: unknown) {
  const result = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result)) {
    throw new CommandError("INVALID_APPOINTMENT_INPUT", "Appointment date is invalid.");
  }
  return result;
}

function timeValue(value: unknown) {
  const result = String(value ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(result)) {
    throw new CommandError("INVALID_APPOINTMENT_INPUT", "Appointment time is invalid.");
  }
  return result.slice(0, 5);
}

function calendarDateOffset(days: number) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function enforceReadLimit(name: keyof typeof CALENDAR_LIMITS, rows: readonly unknown[]) {
  if (rows.length > CALENDAR_LIMITS[name]) {
    throw new CommandError(
      "CALENDAR_RESULT_LIMIT",
      `Calendar has more ${name} than this launch-safe view can load. Narrowing and pagination are required.`,
      409,
    );
  }
}

function friendlyAppointmentError(error: { message: string; code?: string | null; details?: string | null }) {
  const combined = `${error.message} ${error.details ?? ""}`.toLowerCase();
  if (combined.includes("bookings_room_effective_time_exclusion") || combined.includes("conflicts with another booking for this room")) {
    return new CommandError("APPOINTMENT_ROOM_CONFLICT", "That room already has an Appointment during the effective occupied time.", 409);
  }
  if (error.code === "23P01" || combined.includes("conflicts with another booking for this staff member")) {
    return new CommandError("APPOINTMENT_CONFLICT", "That staff member already has an Appointment during the effective occupied time.", 409);
  }
  if (combined.includes("outside the staff member working hours")) {
    return new CommandError("APPOINTMENT_OUTSIDE_WORKING_HOURS", "This Appointment does not fit inside the staff member's configured working hours, including preparation and recovery time.", 409);
  }
  if (combined.includes("overlaps a staff break")) {
    return new CommandError("APPOINTMENT_BREAK_CONFLICT", "This Appointment overlaps a configured staff break.", 409);
  }
  if (combined.includes("overlaps staff leave")) {
    return new CommandError("APPOINTMENT_LEAVE_CONFLICT", "This Appointment overlaps recorded staff leave.", 409);
  }
  if (combined.includes("active configured room")) {
    return new CommandError("APPOINTMENT_ROOM_INVALID", "Choose an active configured Calendar room or leave the room unassigned.", 409);
  }
  if (combined.includes("effective time must remain within one working day")) {
    return new CommandError("APPOINTMENT_DAY_BOUNDARY", "The Appointment and its buffers must remain within one local working day.", 409);
  }
  if (combined.includes("not eligible for this service")) {
    return new CommandError(
      "APPOINTMENT_STAFF_SERVICE_INELIGIBLE",
      "Choose a staff member who is assigned to perform this Service.",
      409,
    );
  }
  if (combined.includes("changed on another device")) {
    return new CommandError("APPOINTMENT_VERSION_CONFLICT", "This Appointment changed on another device. Refresh before saving.", 409);
  }
  if (combined.includes("write access denied") || combined.includes("access denied")) {
    return new CommandError("APPOINTMENT_FORBIDDEN", "You do not have permission to change Appointments.", 403);
  }
  if (combined.includes("archived customers")) {
    return new CommandError("APPOINTMENT_CUSTOMER_ARCHIVED", "Restore this Customer before creating a new Appointment.", 409);
  }
  if (combined.includes("archived services")) {
    return new CommandError("APPOINTMENT_SERVICE_ARCHIVED", "Restore this Service before creating a new Appointment.", 409);
  }
  if (combined.includes("not active in this workspace")) {
    return new CommandError("APPOINTMENT_STAFF_INACTIVE", "Choose an active staff member from this workspace.", 409);
  }
  if (combined.includes("not found")) {
    return new CommandError("APPOINTMENT_NOT_FOUND", "The Appointment or one of its connected records could not be found.", 404);
  }
  if (combined.includes("only pending") || combined.includes("only confirmed") || combined.includes("can be rescheduled")) {
    return new CommandError("APPOINTMENT_TRANSITION_INVALID", error.message, 409);
  }
  return new CommandError("APPOINTMENT_COMMAND_FAILED", error.message, 400);
}

async function requireCalendarRead(request: Request, workspaceId: string) {
  const context = await requireWorkspaceCommand(request, workspaceId);

  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

  const featureResult = await supabase.rpc("get_effective_features", { target_workspace_id: workspaceId });
  if (featureResult.error) throw featureResult.error;
  const calendarEnabled = ((featureResult.data ?? []) as Array<{ feature_key: string; enabled: boolean }>)
    .some((feature) => feature.feature_key === "calendar" && feature.enabled);
  if (!calendarEnabled) throw new CommandError("APPOINTMENT_FORBIDDEN", "Calendar is not enabled for this workspace.", 403);

  if (context.accessProfile === "custom") {
    const { data, error } = await admin
      .from("workspace_member_permissions")
      .select("can_view")
      .eq("workspace_id", workspaceId)
      .eq("user_id", context.userId)
      .eq("feature_key", "calendar")
      .maybeSingle();
    if (error) throw error;
    if (!data?.can_view) throw new CommandError("APPOINTMENT_FORBIDDEN", "You do not have permission to view Calendar.", 403);
  }

  return context;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    await requireCalendarRead(request, workspaceId);
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [appointmentsResult, customersResult, servicesResult, membersResult, roomsResult, eligibilityResult, settingsResult] = await Promise.all([
      admin
        .from("bookings")
        .select("*")
        .eq("workspace_id", workspaceId)
        .gte("booking_date", calendarDateOffset(-180))
        .lte("booking_date", calendarDateOffset(550))
        .order("booking_date")
        .order("booking_time")
        .limit(CALENDAR_LIMITS.appointments + 1),
      admin
        .from("customers")
        .select("id,code,name,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name")
        .limit(CALENDAR_LIMITS.customers + 1),
      admin
        .from("services")
        .select("id,code,name,duration_minutes,preparation_buffer_minutes,recovery_buffer_minutes,price,vat_rate,booking_mode,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name")
        .limit(CALENDAR_LIMITS.services + 1),
      admin
        .from("workspace_memberships")
        .select("user_id,role,access_profile,status,profiles(full_name,is_active)")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("created_at")
        .limit(CALENDAR_LIMITS.staff + 1),
      admin
        .from("calendar_rooms")
        .select("id,code,name,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name")
        .limit(CALENDAR_LIMITS.rooms + 1),
      admin
        .from("calendar_staff_service_eligibility")
        .select("service_id,staff_user_id,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("service_id")
        .order("staff_user_id")
        .limit(CALENDAR_LIMITS.eligibility + 1),
      admin
        .from("workspace_settings")
        .select("timezone")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

    const failed = [appointmentsResult, customersResult, servicesResult, membersResult, roomsResult, eligibilityResult, settingsResult]
      .find((result) => result.error);
    if (failed?.error) throw failed.error;
    enforceReadLimit("appointments", appointmentsResult.data ?? []);
    enforceReadLimit("customers", customersResult.data ?? []);
    enforceReadLimit("services", servicesResult.data ?? []);
    enforceReadLimit("staff", membersResult.data ?? []);
    enforceReadLimit("rooms", roomsResult.data ?? []);
    enforceReadLimit("eligibility", eligibilityResult.data ?? []);

    const staff = (membersResult.data ?? [])
      .filter((member) => {
        const profile = member.profiles as unknown as { full_name?: string | null; is_active?: boolean } | null;
        return profile?.is_active !== false;
      })
      .map((member) => {
        const profile = member.profiles as unknown as { full_name?: string | null } | null;
        return {
          user_id: member.user_id,
          name: profile?.full_name || "Workspace staff member",
          role: member.role,
          access_profile: member.access_profile,
        };
      });

    return {
      workspaceId,
      timezone: settingsResult.data?.timezone || "Europe/London",
      appointments: appointmentsResult.data ?? [],
      customers: customersResult.data ?? [],
      services: servicesResult.data ?? [],
      staff,
      rooms: roomsResult.data ?? [],
      eligibility: eligibilityResult.data ?? [],
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<AppointmentCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const bookingId = uuid(body.id, "Appointment ID");
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) throw new CommandError("INVALID_APPOINTMENT_ACTION", "Appointment action is invalid.");

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Appointment changes.");
    }

    const connectedValues = action === "create" || action === "update"
      ? {
        customerId: uuid(body.customerId, "Customer"),
        serviceId: uuid(body.serviceId, "Service"),
        staffUserId: uuid(body.staffUserId, "Staff member"),
        bookingDate: dateValue(body.bookingDate),
        bookingTime: timeValue(body.bookingTime),
        channel: String(body.channel ?? "staff").trim(),
        roomName: optionalText(body.roomName, 120),
        notes: optionalText(body.notes, 4000),
        initialStatus: String(body.initialStatus ?? "pending").trim(),
      }
      : {
        customerId: null,
        serviceId: null,
        staffUserId: null,
        bookingDate: null,
        bookingTime: null,
        channel: "staff",
        roomName: null,
        notes: null,
        initialStatus: "pending",
      };

    if (!CHANNELS.has(connectedValues.channel)) {
      throw new CommandError("INVALID_APPOINTMENT_INPUT", "Appointment booking source is invalid.");
    }
    if (action === "create" && !INITIAL_STATUSES.has(connectedValues.initialStatus)) {
      throw new CommandError("INVALID_APPOINTMENT_INPUT", "Appointment initial status is invalid.");
    }

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("apply_appointment_command", {
      p_workspace_id: workspaceId,
      p_booking_id: bookingId,
      p_action: action,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_expected_version: action === "create" ? null : expectedVersion(body.expectedVersion),
      p_customer_id: optionalUuid(connectedValues.customerId, "Customer"),
      p_service_id: optionalUuid(connectedValues.serviceId, "Service"),
      p_staff_user_id: optionalUuid(connectedValues.staffUserId, "Staff member"),
      p_booking_date: connectedValues.bookingDate,
      p_booking_time: connectedValues.bookingTime,
      p_channel: connectedValues.channel,
      p_room_name: connectedValues.roomName,
      p_notes: connectedValues.notes,
      p_initial_status: connectedValues.initialStatus,
      p_cancellation_reason: optionalText(body.cancellationReason, 500),
    });
    if (error) throw friendlyAppointmentError(error);

    return data as Record<string, unknown>;
  });
}
