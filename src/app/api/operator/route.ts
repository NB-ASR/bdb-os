import { workflowKeys, type SectorWorkflowKey } from "@/lib/sector-packs";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";
import { buildVerifiedOperatorPlan } from "@/lib/server/operator";
import { processOperatorQueue } from "@/lib/server/operator-worker";
import { createClient } from "@/lib/supabase/server";

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: { message: string } | null };

function requireQuery(result: QueryResult, label: string) {
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return (result.data ?? []) as Row[];
}

function isWorkflow(value: unknown): value is SectorWorkflowKey {
  return workflowKeys.includes(String(value) as SectorWorkflowKey);
}

function stringValue(value: unknown) {
  return value == null ? "" : String(value);
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function mapPolicy(row: Row) {
  return {
    id: stringValue(row.id),
    workflowKey: stringValue(row.workflow_key),
    enabled: Boolean(row.enabled),
    autonomyMode: stringValue(row.autonomy_mode),
    providerMode: stringValue(row.provider_mode),
    config: row.config ?? {},
    blueprintKey: stringValue(row.blueprint_key),
    blueprintVersion: numberValue(row.blueprint_version),
    updatedAt: stringValue(row.updated_at),
  };
}

function mapRun(row: Row) {
  return {
    id: stringValue(row.id),
    workflowKey: stringValue(row.workflow_key),
    sourceType: stringValue(row.source_type),
    sourceId: stringValue(row.source_id),
    status: stringValue(row.status),
    autonomyMode: stringValue(row.autonomy_mode),
    providerMode: stringValue(row.provider_mode),
    riskLevel: stringValue(row.risk_level),
    plannedAction: row.planned_action ?? {},
    evidence: row.evidence ?? {},
    errorCode: row.error_code ? stringValue(row.error_code) : undefined,
    errorMessage: row.error_message ? stringValue(row.error_message) : undefined,
    estimatedMinutesSaved: numberValue(row.estimated_minutes_saved),
    attempts: numberValue(row.attempts),
    maxAttempts: numberValue(row.max_attempts),
    revision: numberValue(row.revision),
    scheduledAt: stringValue(row.scheduled_at),
    createdAt: stringValue(row.created_at),
    completedAt: row.completed_at ? stringValue(row.completed_at) : undefined,
  };
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [policiesResult, runsResult, approvalsResult, exceptionsResult, valuesResult] = await Promise.all([
      supabase.from("operator_policies").select("*").eq("workspace_id", workspaceId).order("workflow_key"),
      supabase.from("operator_runs").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
      supabase.from("operator_approvals").select("*").eq("workspace_id", workspaceId).order("requested_at", { ascending: false }).limit(100),
      supabase.from("operator_exceptions").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(100),
      supabase.from("operator_value_events").select("*").eq("workspace_id", workspaceId).order("recorded_at", { ascending: false }).limit(250),
    ]);

    const policies = requireQuery(policiesResult, "Operator policies could not be loaded").map(mapPolicy);
    const runs = requireQuery(runsResult, "Operator runs could not be loaded").map(mapRun);
    const approvals = requireQuery(approvalsResult, "Operator approvals could not be loaded").map((row) => ({
      id: stringValue(row.id),
      runId: stringValue(row.run_id),
      status: stringValue(row.status),
      requestedAt: stringValue(row.requested_at),
      decidedAt: row.decided_at ? stringValue(row.decided_at) : undefined,
      decisionNote: row.decision_note ? stringValue(row.decision_note) : undefined,
    }));
    const exceptions = requireQuery(exceptionsResult, "Operator exceptions could not be loaded").map((row) => ({
      id: stringValue(row.id),
      runId: stringValue(row.run_id),
      code: stringValue(row.code),
      title: stringValue(row.title),
      detail: stringValue(row.detail),
      severity: stringValue(row.severity),
      status: stringValue(row.status),
      createdAt: stringValue(row.created_at),
    }));
    const valueEvents = requireQuery(valuesResult, "Operator value evidence could not be loaded").map((row) => ({
      id: stringValue(row.id),
      runId: stringValue(row.run_id),
      category: stringValue(row.category),
      minutesSaved: numberValue(row.minutes_saved),
      cashProtected: numberValue(row.cash_protected),
      currency: stringValue(row.currency),
      verified: Boolean(row.verified),
      evidenceSource: stringValue(row.evidence_source),
      recordedAt: stringValue(row.recorded_at),
    }));

    return { policies, runs, approvals, exceptions, valueEvents };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody(request);
    const workspaceId = stringValue(body.workspaceId);
    const action = stringValue(body.action);
    const context = await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    if (action === "save_policy") {
      if (!isWorkflow(body.workflowKey)) throw new CommandError("WORKFLOW_INVALID", "Choose a published workflow.");
      const { data, error } = await supabase.rpc("set_operator_policy", {
        p_workspace_id: workspaceId,
        p_workflow_key: body.workflowKey,
        p_enabled: Boolean(body.enabled),
        p_autonomy_mode: stringValue(body.autonomyMode),
        p_provider_mode: stringValue(body.providerMode || "unconfigured"),
        p_config: typeof body.config === "object" && body.config ? body.config : {},
      });
      if (error) throw error;
      return data;
    }

    if (action === "plan") {
      if (!context.idempotencyKey) {
        throw new CommandError("IDEMPOTENCY_REQUIRED", "This operation requires an idempotency key.");
      }
      if (!isWorkflow(body.workflowKey)) throw new CommandError("WORKFLOW_INVALID", "Choose a published workflow.");
      const sourceType = stringValue(body.sourceType) as "booking" | "invoice" | "message";
      if (!(["booking", "invoice", "message"] as const).includes(sourceType)) {
        throw new CommandError("SOURCE_INVALID", "Choose a supported business record.");
      }
      const plan = await buildVerifiedOperatorPlan({
        workspaceId,
        workflowKey: body.workflowKey,
        sourceType,
        sourceId: stringValue(body.sourceId),
      });
      const { data, error } = await supabase.rpc("create_operator_run", {
        p_workspace_id: workspaceId,
        p_workflow_key: plan.workflowKey,
        p_source_type: plan.sourceType,
        p_source_id: plan.sourceId,
        p_risk_level: plan.riskLevel,
        p_planned_action: plan.plannedAction,
        p_estimated_minutes_saved: plan.estimatedMinutesSaved,
        p_idempotency_key: context.idempotencyKey,
      });
      if (error) throw error;
      let dispatch: unknown = null;
      if ((data as { status?: string } | null)?.status === "queued") {
        try {
          dispatch = await processOperatorQueue(5);
        } catch (dispatchError) {
          console.error("[api/operator] immediate dispatch deferred", {
            runId: (data as { id?: string } | null)?.id,
            error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
          });
        }
      }
      return { run: data, dispatch };
    }

    if (action === "decision") {
      const decision = stringValue(body.decision);
      if (!(["approved", "rejected"] as const).includes(decision as "approved" | "rejected")) {
        throw new CommandError("DECISION_INVALID", "Choose approve or reject.");
      }
      const { data, error } = await supabase.rpc("decide_operator_run", {
        p_workspace_id: workspaceId,
        p_run_id: stringValue(body.runId),
        p_decision: decision,
        p_expected_revision: numberValue(body.revision),
        p_note: body.note ? stringValue(body.note) : null,
      });
      if (error) throw error;
      let dispatch: unknown = null;
      if ((data as { status?: string } | null)?.status === "queued") {
        try {
          dispatch = await processOperatorQueue(5);
        } catch (dispatchError) {
          console.error("[api/operator] approved run remains queued", {
            runId: stringValue(body.runId),
            error: dispatchError instanceof Error ? dispatchError.message : String(dispatchError),
          });
        }
      }
      return { run: data, dispatch };
    }

    if (action === "complete_manual") {
      const { data, error } = await supabase.rpc("complete_operator_run_manually", {
        p_workspace_id: workspaceId,
        p_run_id: stringValue(body.runId),
        p_expected_revision: numberValue(body.revision),
      });
      if (error) throw error;
      return data;
    }

    throw new CommandError("ACTION_INVALID", "Choose a supported Operator action.");
  });
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store, max-age=0" } });
}
