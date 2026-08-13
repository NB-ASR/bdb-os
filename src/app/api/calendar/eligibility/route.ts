import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type EligibilityBody = Record<string, unknown> & {
  workspaceId?: unknown;
  staffUserId?: unknown;
  serviceId?: unknown;
  isEligible?: unknown;
  expectedVersion?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_CALENDAR_SERVICE_ELIGIBILITY", `${field} is invalid.`);
  }
  return result;
}

function version(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new CommandError(
      "INVALID_CALENDAR_SERVICE_ELIGIBILITY",
      "Refresh before changing this eligibility assignment.",
    );
  }
  return result;
}

function friendlyError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("changed on another device")) {
    return new CommandError("CALENDAR_SERVICE_ELIGIBILITY_CONFLICT", error.message, 409);
  }
  if (message.includes("reschedule or cancel")) {
    return new CommandError("CALENDAR_SERVICE_ELIGIBILITY_IN_USE", error.message, 409);
  }
  if (message.includes("only active")) {
    return new CommandError("CALENDAR_SERVICE_ELIGIBILITY_INACTIVE_RECORD", error.message, 409);
  }
  if (message.includes("access denied")) {
    return new CommandError(
      "CALENDAR_SERVICE_ELIGIBILITY_FORBIDDEN",
      "Manager approval permission is required to manage staff-to-Service eligibility.",
      403,
    );
  }
  if (message.includes("not found")) {
    return new CommandError("CALENDAR_SERVICE_ELIGIBILITY_NOT_FOUND", error.message, 404);
  }
  return new CommandError("CALENDAR_SERVICE_ELIGIBILITY_FAILED", error.message, 400);
}

async function requireCalendarRead(request: Request, workspaceId: string) {
  const context = await requireWorkspaceCommand(request, workspaceId);

  const supabase = await createClient();
  const admin = createAdminClient();
  if (!supabase || !admin) {
    throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  }

  const featureResult = await supabase.rpc("get_effective_features", {
    target_workspace_id: workspaceId,
  });
  if (featureResult.error) throw featureResult.error;
  const calendarEnabled = ((featureResult.data ?? []) as Array<{ feature_key: string; enabled: boolean }>)
    .some((feature) => feature.feature_key === "calendar" && feature.enabled);
  if (!calendarEnabled) {
    throw new CommandError(
      "CALENDAR_SERVICE_ELIGIBILITY_FORBIDDEN",
      "Calendar is not enabled for this workspace.",
      403,
    );
  }

  if (context.accessProfile === "custom") {
    const { data, error } = await admin
      .from("workspace_member_permissions")
      .select("can_view")
      .eq("workspace_id", workspaceId)
      .eq("user_id", context.userId)
      .eq("feature_key", "calendar")
      .maybeSingle();
    if (error) throw error;
    if (!data?.can_view) {
      throw new CommandError(
        "CALENDAR_SERVICE_ELIGIBILITY_FORBIDDEN",
        "You do not have permission to view Calendar eligibility.",
        403,
      );
    }
  }

  return context;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    const context = await requireCalendarRead(request, workspaceId);
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [services, members, eligibility, permission] = await Promise.all([
      admin
        .from("services")
        .select("id,code,name,category,duration_minutes,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name"),
      admin
        .from("workspace_memberships")
        .select("user_id,role,access_profile,status,profiles(full_name,is_active)")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("created_at"),
      admin
        .from("calendar_staff_service_eligibility")
        .select("workspace_id,staff_user_id,service_id,status,version,updated_at")
        .eq("workspace_id", workspaceId),
      context.accessProfile === "custom"
        ? admin
          .from("workspace_member_permissions")
          .select("can_approve")
          .eq("workspace_id", workspaceId)
          .eq("user_id", context.userId)
          .eq("feature_key", "calendar")
          .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);

    const failed = [services, members, eligibility, permission].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const staff = (members.data ?? [])
      .filter((member) => {
        const profile = member.profiles as unknown as { is_active?: boolean } | null;
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

    const canManage = context.accessProfile === "owner"
      || context.accessProfile === "manager"
      || (context.accessProfile === "custom" && Boolean(permission.data?.can_approve));

    return {
      workspaceId,
      canManage,
      services: services.data ?? [],
      staff,
      eligibility: eligibility.data ?? [],
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<EligibilityBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const staffUserId = uuid(body.staffUserId, "Staff member");
    const serviceId = uuid(body.serviceId, "Service");
    if (typeof body.isEligible !== "boolean") {
      throw new CommandError(
        "INVALID_CALENDAR_SERVICE_ELIGIBILITY",
        "Eligibility state is required.",
      );
    }

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError(
        "IDEMPOTENCY_REQUIRED",
        "An idempotency key is required for eligibility changes.",
      );
    }

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("apply_calendar_service_eligibility_command", {
      p_workspace_id: workspaceId,
      p_staff_user_id: staffUserId,
      p_service_id: serviceId,
      p_is_eligible: body.isEligible,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_expected_version: version(body.expectedVersion),
    });
    if (error) throw friendlyError(error);

    return data as Record<string, unknown>;
  });
}
