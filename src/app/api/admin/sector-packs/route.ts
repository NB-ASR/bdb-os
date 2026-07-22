import { createAdminClient } from "@/lib/supabase/admin";
import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";
import { resolveWorkspaceBlueprint } from "@/lib/sector-packs";

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

async function loadDashboard(admin: AdminClient) {
  const [workspaces, packs, configs] = await Promise.all([
    admin.from("workspaces").select("id,name,slug,status").order("name"),
    admin.from("sector_packs").select("id,key,version,name,sector,description,config,is_active,updated_at").eq("is_active", true).order("sector").order("name"),
    admin.from("workspace_sector_configs").select("workspace_id,sector_pack_id,draft_overrides,published_config,status,published_at,updated_at"),
  ]);
  const failed = [workspaces, packs, configs].find((result) => result.error);
  if (failed?.error) throw failed.error;
  return {
    workspaces: workspaces.data ?? [],
    packs: packs.data ?? [],
    configs: configs.data ?? [],
  };
}

async function audit(admin: AdminClient, userId: string, workspaceId: string, action: string, metadata: JsonObject) {
  const { error } = await admin.from("audit_logs").insert({
    actor_user_id: userId,
    workspace_id: workspaceId,
    action,
    entity_type: "workspace_sector_config",
    entity_id: workspaceId,
    metadata,
  });
  if (error) throw error;
}

export async function GET() {
  try {
    await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    return Response.json(await loadDashboard(admin));
  } catch (error) {
    return adminErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");
    const body = await request.json() as {
      action?: string;
      workspaceId?: string;
      sectorPackId?: string;
      overrides?: unknown;
    };
    const workspaceId = String(body.workspaceId ?? "");
    if (!workspaceId) return Response.json({ error: "Choose a client workspace." }, { status: 400 });

    const { data: workspace, error: workspaceError } = await admin
      .from("workspaces")
      .select("id,name")
      .eq("id", workspaceId)
      .maybeSingle();
    if (workspaceError) throw workspaceError;
    if (!workspace) return Response.json({ error: "The client workspace was not found." }, { status: 404 });

    if (body.action === "save-draft") {
      const sectorPackId = String(body.sectorPackId ?? "");
      if (!sectorPackId) return Response.json({ error: "Choose a sector pack." }, { status: 400 });
      const { data: pack, error: packError } = await admin
        .from("sector_packs")
        .select("id,config,is_active")
        .eq("id", sectorPackId)
        .maybeSingle();
      if (packError) throw packError;
      if (!pack?.is_active) return Response.json({ error: "The selected sector pack is not active." }, { status: 400 });

      const overrides = asObject(body.overrides);
      resolveWorkspaceBlueprint(pack.config, overrides);
      const now = new Date().toISOString();
      const { error } = await admin.from("workspace_sector_configs").upsert({
        workspace_id: workspaceId,
        sector_pack_id: sectorPackId,
        draft_overrides: overrides,
        status: "draft",
        updated_by: identity.userId,
        updated_at: now,
      }, { onConflict: "workspace_id" });
      if (error) throw error;
      await audit(admin, identity.userId, workspaceId, "sector_config.draft_saved", {
        sector_pack_id: sectorPackId,
        override_keys: Object.keys(overrides),
      });
      return Response.json({ ok: true });
    }

    if (body.action === "publish") {
      const { data: config, error: configError } = await admin
        .from("workspace_sector_configs")
        .select("sector_pack_id,draft_overrides")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (configError) throw configError;
      if (!config) return Response.json({ error: "Save a sector pack draft before publishing." }, { status: 409 });
      const { data: pack, error: packError } = await admin
        .from("sector_packs")
        .select("id,key,version,config,is_active")
        .eq("id", config.sector_pack_id)
        .maybeSingle();
      if (packError) throw packError;
      if (!pack?.is_active) return Response.json({ error: "The selected sector pack is no longer active." }, { status: 409 });

      const published = resolveWorkspaceBlueprint(pack.config, config.draft_overrides);
      const now = new Date().toISOString();
      const { error } = await admin.from("workspace_sector_configs").update({
        published_config: published,
        status: "published",
        published_at: now,
        updated_by: identity.userId,
        updated_at: now,
      }).eq("workspace_id", workspaceId);
      if (error) throw error;
      await audit(admin, identity.userId, workspaceId, "sector_config.published", {
        sector_pack_id: pack.id,
        sector_pack_key: pack.key,
        sector_pack_version: pack.version,
      });
      return Response.json({ ok: true, published });
    }

    return Response.json({ error: "Invalid sector pack action." }, { status: 400 });
  } catch (error) {
    return adminErrorResponse(error);
  }
}
