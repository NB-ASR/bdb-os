import { adminErrorResponse, requirePlatformAdmin } from "@/lib/admin-auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildUsageMetrics } from "@/lib/usage-metering";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type UsageSnapshot = {
  workspaceId: string;
  period: {
    id: string;
    start: string;
    end: string;
    planId: string | null;
    planCode: string | null;
    planName: string | null;
    allowances: Record<string, { unit?: string | null; included_quantity?: number | string | null; warning_threshold_percent?: number | string | null }>;
    measurementStartedAt: string;
  };
  measured: Record<string, number | string | null>;
  context: { invited_users?: number | string | null };
  baselines: Record<string, unknown>;
  indicators: Record<string, number | string | null>;
  sources: Record<string, string>;
};

function workspaceId(value: string | null) {
  const id = String(value ?? "").trim();
  if (!UUID_PATTERN.test(id)) throw new Error("INVALID_WORKSPACE");
  return id;
}

function usageError(error: unknown) {
  if (error instanceof Error && error.message === "INVALID_WORKSPACE") {
    return Response.json({ error: "Choose a valid client business." }, { status: 400 });
  }
  return adminErrorResponse(error);
}

export async function GET(request: Request) {
  try {
    await requirePlatformAdmin();
    const admin = createAdminClient();
    if (!admin) throw new Error("NOT_CONFIGURED");

    const id = workspaceId(new URL(request.url).searchParams.get("workspaceId"));
    const snapshotResult = await admin.rpc("get_founder_workspace_usage_snapshot", {
      p_workspace_id: id,
      p_at: new Date().toISOString(),
    });
    if (snapshotResult.error) throw snapshotResult.error;

    const snapshot = snapshotResult.data as UsageSnapshot;
    const metrics = buildUsageMetrics(snapshot.measured ?? {}, snapshot.period?.allowances ?? {});
    const recentEvents = await admin
      .from("workspace_usage_events")
      .select("id,metric_key,quantity,unit,source_type,source_id,occurred_at,metadata")
      .eq("workspace_id", id)
      .eq("usage_period_id", snapshot.period.id)
      .order("occurred_at", { ascending: false })
      .limit(20);
    if (recentEvents.error) throw recentEvents.error;

    return Response.json({
      ok: true,
      ...snapshot,
      metrics,
      recentEvents: recentEvents.data ?? [],
      measurementOnly: true,
      automaticCharging: false,
      sourceNotes: {
        storage_bytes: "Live bytes currently stored in BDB OS private workspace storage.",
        active_users: "Current active workspace memberships. Invited users are shown separately and are not counted as active seats.",
        automation_executions: "Durable BDB Operator runs that entered execution or an execution terminal state, reconciled idempotently.",
        outbound_emails: "Recorded outbound Email communications. Provider delivery is not yet separately verified.",
        sms_segments: "SMS transport is not connected yet. The meter and allowance key are reserved, but no SMS usage is inferred.",
      },
    });
  } catch (error) {
    return usageError(error);
  }
}
