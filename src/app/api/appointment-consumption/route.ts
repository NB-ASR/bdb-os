import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_APPOINTMENT_CONSUMPTION_INPUT", `${field} is invalid.`);
  }
  return result;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    const context = await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    const admin = createAdminClient();
    if (!supabase || !admin) {
      throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    }

    const permissionPromise = context.accessProfile === "custom"
      ? admin
        .from("workspace_member_permissions")
        .select("can_create,can_edit")
        .eq("workspace_id", workspaceId)
        .eq("user_id", context.userId)
        .eq("feature_key", "inventory")
        .maybeSingle()
      : Promise.resolve({ data: null, error: null });

    const [
      appointmentsResult,
      productsResult,
      locationsResult,
      balancesResult,
      movementsResult,
      settingsResult,
      featuresResult,
      permissionResult,
    ] = await Promise.all([
      supabase
        .from("bookings")
        .select("id,reference,customer_id,customer_name_snapshot,service_id,service_code_snapshot,title,staff_user_id,staff_name,completed_at,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "completed")
        .not("service_id", "is", null)
        .order("completed_at", { ascending: false })
        .limit(300),
      supabase
        .from("products")
        .select("id,sku,name,category,purpose,unit_label,unit_cost,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .eq("purpose", "supply")
        .order("name"),
      supabase
        .from("inventory_locations")
        .select("id,code,name,is_default,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("is_default", { ascending: false })
        .order("name"),
      supabase
        .from("inventory_stock_balances")
        .select("workspace_id,product_id,location_id,quantity")
        .eq("workspace_id", workspaceId),
      supabase
        .from("inventory_movements")
        .select("id,workspace_id,product_id,location_id,appointment_id,movement_type,quantity_delta,unit_cost,currency,source_type,source_id,reversal_of_id,note,metadata,occurred_at,posted_at,actor_user_id")
        .eq("workspace_id", workspaceId)
        .eq("source_type", "appointment_consumption")
        .not("appointment_id", "is", null)
        .order("occurred_at", { ascending: false })
        .order("posted_at", { ascending: false })
        .limit(500),
      supabase
        .from("workspace_settings")
        .select("currency,timezone")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
      supabase.rpc("get_effective_features", { target_workspace_id: workspaceId }),
      permissionPromise,
    ]);

    const failed = [
      appointmentsResult,
      productsResult,
      locationsResult,
      balancesResult,
      movementsResult,
      settingsResult,
      featuresResult,
      permissionResult,
    ].find((result) => result.error);
    if (failed?.error) throw failed.error;

    const enabledFeatures = new Set(
      ((featuresResult.data ?? []) as Array<{ feature_key: string; enabled: boolean }>)
        .filter((feature) => feature.enabled)
        .map((feature) => feature.feature_key),
    );
    if (!enabledFeatures.has("inventory") || !enabledFeatures.has("products") || !enabledFeatures.has("calendar")) {
      throw new CommandError(
        "APPOINTMENT_CONSUMPTION_FEATURES_UNAVAILABLE",
        "Calendar, Products and Inventory must be enabled to record Appointment Product consumption.",
        403,
      );
    }

    const canManage = context.accessMode === "support_test_write"
      || context.accessProfile === "owner"
      || context.accessProfile === "manager"
      || context.accessProfile === "employee"
      || (context.accessProfile === "custom"
        && Boolean(permissionResult.data?.can_create || permissionResult.data?.can_edit));

    return {
      workspaceId,
      canManage,
      currency: settingsResult.data?.currency ?? "GBP",
      timezone: settingsResult.data?.timezone ?? "Europe/London",
      completedAppointments: appointmentsResult.data ?? [],
      supplyProducts: productsResult.data ?? [],
      locations: locationsResult.data ?? [],
      balances: balancesResult.data ?? [],
      movements: movementsResult.data ?? [],
    };
  });
}
