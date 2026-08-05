import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";

function templateFailure(error: unknown) {
  const message = error instanceof Error ? error.message : "TEMPLATE_REQUEST_FAILED";
  const known: Record<string, string> = {
    PLATFORM_ADMIN_REQUIRED: "Founder access is required.",
    INVALID_TEMPLATE_CODE: "Use a lowercase template code containing letters, numbers and hyphens.",
    INVALID_TEMPLATE_NAME: "Enter a template name between 2 and 100 characters.",
    ACTIVE_PLAN_REQUIRED: "Choose an active plan.",
    INVALID_TEMPLATE_CURRENCY: "Currency must be a three-letter code.",
    INVALID_TEMPLATE_INVOICE_PREFIX: "Invoice prefix must be 1 to 12 letters, numbers or hyphens.",
    INVALID_TEMPLATE_VAT_RATE: "VAT rate must be between 0 and 100.",
    INVALID_TEMPLATE_TIMEZONE: "Choose a valid IANA timezone.",
    INVALID_TEMPLATE_MODE: "Appearance mode must be dark or light.",
    INVALID_TEMPLATE_DENSITY: "Density must be comfortable or compact.",
    INVALID_TEMPLATE_ACCENT: "Accent colour must be a six-digit hex value.",
    INVALID_TEMPLATE_TEXT_SCALE: "Text scale must be between 0.8 and 1.4.",
    INCOMPLETE_TEMPLATE_FEATURE_MATRIX: "Every active module must have one template setting.",
    INCOMPLETE_TEMPLATE_PERMISSION_MATRIX: "Manager, Employee and Custom presets must cover every active module.",
    TEMPLATE_NOT_FOUND: "Workspace template not found.",
  };
  const code = Object.keys(known).find((item) => message.includes(item));
  if (code) return Response.json({ error: known[code], code }, { status: 400 });
  if (message.includes("workspace_templates_code_key")) {
    return Response.json({ error: "That template code already exists.", code: "TEMPLATE_CODE_EXISTS" }, { status: 409 });
  }
  return adminErrorResponse(error);
}

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");

    const [templates, templateFeatures, permissions, plans, planFeatures, modules, usage] = await Promise.all([
      admin.from("workspace_templates").select("*").order("is_default", { ascending: false }).order("name"),
      admin.from("workspace_template_features").select("template_id,feature_key,enabled"),
      admin.from("workspace_template_permissions").select("template_id,access_profile,feature_key,can_view,can_create,can_edit,can_delete,can_approve,can_export"),
      admin.from("plans").select("id,code,name,description,is_active,sort_order").eq("is_active", true).order("sort_order"),
      admin.from("plan_features").select("plan_id,feature_key,enabled"),
      admin.from("features").select("key,name,description,category,route,is_active,sort_order").eq("is_active", true).order("sort_order"),
      admin.from("workspaces").select("workspace_template_id,workspace_template_version"),
    ]);
    const failed = [templates, templateFeatures, permissions, plans, planFeatures, modules, usage]
      .find((result) => result.error);
    if (failed?.error) throw failed.error;

    const counts = new Map<string, number>();
    for (const workspace of usage.data ?? []) {
      if (!workspace.workspace_template_id) continue;
      counts.set(workspace.workspace_template_id, (counts.get(workspace.workspace_template_id) ?? 0) + 1);
    }

    return Response.json({
      templates: (templates.data ?? []).map((template) => ({
        ...template,
        workspace_count: counts.get(template.id) ?? 0,
      })),
      templateFeatures: templateFeatures.data ?? [],
      templatePermissions: permissions.data ?? [],
      plans: plans.data ?? [],
      planFeatures: planFeatures.data ?? [],
      features: modules.data ?? [],
    });
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = (await request.json()) as Record<string, unknown>;

    const templateId = String(body.templateId ?? "").trim() || null;
    const code = String(body.code ?? "").trim().toLowerCase();
    const name = String(body.name ?? "").trim();
    const description = String(body.description ?? "").trim();
    const planId = String(body.planId ?? "").trim();
    const features = Array.isArray(body.features) ? body.features : [];
    const permissions = Array.isArray(body.permissions) ? body.permissions : [];
    const settingsDefaults = body.settingsDefaults && typeof body.settingsDefaults === "object"
      ? body.settingsDefaults
      : {};
    const themeDefaults = body.themeDefaults && typeof body.themeDefaults === "object"
      ? body.themeDefaults
      : {};

    if (!code || !name || !planId) {
      return Response.json({ error: "Template code, name and plan are required." }, { status: 400 });
    }

    const { data, error } = await admin.rpc("save_workspace_template", {
      target_actor_user_id: identity.userId,
      target_template_id: templateId,
      target_code: code,
      target_name: name,
      target_description: description,
      target_plan_id: planId,
      target_is_active: body.isActive !== false,
      target_is_default: Boolean(body.isDefault),
      target_settings_defaults: settingsDefaults,
      target_theme_defaults: themeDefaults,
      target_features: features,
      target_permissions: permissions,
    });
    if (error) throw error;

    return Response.json({ ok: true, templateId: data });
  } catch (error) {
    return templateFailure(error);
  }
}
