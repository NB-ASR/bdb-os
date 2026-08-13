import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_TYPES = new Set(["working_hours", "break", "leave", "room"]);
const ACTIONS = new Set(["set", "create", "update", "archive", "restore", "cancel"]);

type AvailabilityBody = Record<string, unknown> & {
  workspaceId?: unknown;
  entityType?: unknown;
  action?: unknown;
  id?: unknown;
  expectedVersion?: unknown;
  staffUserId?: unknown;
  weekday?: unknown;
  startTime?: unknown;
  endTime?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  code?: unknown;
  name?: unknown;
  description?: unknown;
  reason?: unknown;
  isWorking?: unknown;
};

function uuid(value: unknown, field: string, optional = false) {
  const result = String(value ?? "").trim();
  if (!result && optional) return null;
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_CALENDAR_AVAILABILITY", `${field} is invalid.`);
  return result;
}

function text(value: unknown, maximum: number, optional = true) {
  const result = String(value ?? "").trim();
  if (!result && optional) return null;
  if (!result || result.length > maximum) throw new CommandError("INVALID_CALENDAR_AVAILABILITY", "A Calendar availability field is invalid.");
  return result;
}

function version(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) throw new CommandError("INVALID_CALENDAR_AVAILABILITY", "Refresh before changing this record.");
  return result;
}

function weekday(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 0 || result > 6) throw new CommandError("INVALID_CALENDAR_AVAILABILITY", "Weekday is invalid.");
  return result;
}

function time(value: unknown) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(result)) {
    throw new CommandError("INVALID_CALENDAR_AVAILABILITY", "Time is invalid.");
  }
  return result.slice(0, 5);
}

function localDateTime(value: unknown) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(result)) {
    throw new CommandError("INVALID_CALENDAR_AVAILABILITY", "Local date and time are invalid.");
  }
  return result.replace("T", " ");
}

function friendlyError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("changed on another device")) {
    return new CommandError("CALENDAR_AVAILABILITY_CONFLICT", error.message, 409);
  }
  if (message.includes("reschedule or cancel") || message.includes("overlap") || error.code === "23P01") {
    return new CommandError("CALENDAR_AVAILABILITY_CONFLICT", error.message, 409);
  }
  if (message.includes("already exists") || error.code === "23505") {
    return new CommandError("CALENDAR_AVAILABILITY_DUPLICATE", error.message, 409);
  }
  if (message.includes("access denied")) {
    return new CommandError("CALENDAR_AVAILABILITY_FORBIDDEN", "Manager approval permission is required to manage availability.", 403);
  }
  if (message.includes("not found")) {
    return new CommandError("CALENDAR_AVAILABILITY_NOT_FOUND", error.message, 404);
  }
  return new CommandError("CALENDAR_AVAILABILITY_FAILED", error.message, 400);
}

async function requireCalendarRead(request: Request, workspaceId: string) {
  const context = await requireWorkspaceCommand(request, workspaceId);
  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

  const featureResult = await supabase.rpc("get_effective_features", { target_workspace_id: workspaceId });
  if (featureResult.error) throw featureResult.error;
  const enabled = ((featureResult.data ?? []) as Array<{ feature_key: string; enabled: boolean }>)
    .some((feature) => feature.feature_key === "calendar" && feature.enabled);
  if (!enabled) throw new CommandError("CALENDAR_AVAILABILITY_FORBIDDEN", "Calendar is not enabled for this workspace.", 403);

  if (context.accessProfile === "custom") {
    const { data, error } = await admin
      .from("workspace_member_permissions")
      .select("can_view")
      .eq("workspace_id", workspaceId)
      .eq("user_id", context.userId)
      .eq("feature_key", "calendar")
      .maybeSingle();
    if (error) throw error;
    if (!data?.can_view) throw new CommandError("CALENDAR_AVAILABILITY_FORBIDDEN", "You do not have permission to view Calendar availability.", 403);
  }
  return context;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace") as string;
    const context = await requireCalendarRead(request, workspaceId);
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [settings, members, hours, breaks, leave, rooms, permission] = await Promise.all([
      admin.from("workspace_settings").select("timezone").eq("workspace_id", workspaceId).maybeSingle(),
      admin.from("workspace_memberships")
        .select("user_id,role,access_profile,status,profiles(full_name,is_active)")
        .eq("workspace_id", workspaceId).eq("status", "active").order("created_at"),
      admin.from("calendar_staff_working_hours").select("*").eq("workspace_id", workspaceId).order("weekday"),
      admin.from("calendar_staff_breaks").select("*").eq("workspace_id", workspaceId).order("weekday").order("start_time"),
      admin.from("calendar_staff_leave").select("*").eq("workspace_id", workspaceId).order("starts_at"),
      admin.from("calendar_rooms").select("*").eq("workspace_id", workspaceId).order("name"),
      context.accessProfile === "custom"
        ? admin.from("workspace_member_permissions").select("can_approve")
          .eq("workspace_id", workspaceId).eq("user_id", context.userId).eq("feature_key", "calendar").maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
    const failed = [settings, members, hours, breaks, leave, rooms, permission].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const staff = (members.data ?? []).filter((member) => {
      const profile = member.profiles as unknown as { is_active?: boolean } | null;
      return profile?.is_active !== false;
    }).map((member) => {
      const profile = member.profiles as unknown as { full_name?: string | null } | null;
      return {
        user_id: member.user_id,
        name: profile?.full_name || "Workspace staff member",
        role: member.role,
        access_profile: member.access_profile,
      };
    });

    const canManage = context.accessProfile === "owner"
      || context.accessProfile === "manager"
      || (context.accessProfile === "custom" && Boolean(permission.data?.can_approve));

    return {
      workspaceId,
      timezone: settings.data?.timezone || "Europe/London",
      canManage,
      staff,
      workingHours: hours.data ?? [],
      breaks: breaks.data ?? [],
      leave: leave.data ?? [],
      rooms: rooms.data ?? [],
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<AvailabilityBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace") as string;
    const entityType = String(body.entityType ?? "").trim();
    const action = String(body.action ?? "").trim();
    if (!ENTITY_TYPES.has(entityType) || !ACTIONS.has(action)) {
      throw new CommandError("INVALID_CALENDAR_AVAILABILITY", "Calendar availability action is invalid.");
    }

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for availability changes.");
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("apply_calendar_availability_command", {
      p_workspace_id: workspaceId,
      p_entity_type: entityType,
      p_action: action,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_entity_id: uuid(body.id, "Record ID", true),
      p_expected_version: version(body.expectedVersion),
      p_staff_user_id: uuid(body.staffUserId, "Staff member", true),
      p_weekday: weekday(body.weekday),
      p_start_time: time(body.startTime),
      p_end_time: time(body.endTime),
      p_starts_at: localDateTime(body.startsAt),
      p_ends_at: localDateTime(body.endsAt),
      p_code: text(body.code, 32),
      p_name: text(body.name, 120),
      p_description: text(body.description, 1000),
      p_reason: text(body.reason, 500),
      p_is_working: typeof body.isWorking === "boolean" ? body.isWorking : null,
    });
    if (error) throw friendlyError(error);
    return data as Record<string, unknown>;
  });
}
