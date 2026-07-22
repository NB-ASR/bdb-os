import { createHmac, randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

type DbRun = {
  id: string;
  workspace_id: string;
  workflow_key: string;
  source_type: string;
  source_id: string;
  status: string;
  provider_mode: "unconfigured" | "mock" | "webhook" | "internal";
  idempotency_key: string;
  planned_action: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
};

type WorkerResult = {
  claimed: number;
  succeeded: number;
  simulated: number;
  retried: number;
  exceptions: number;
  failed: number;
};

export type OperatorPlannerResult = {
  planned: number;
  prepared: number;
  awaitingApproval: number;
  queued: number;
};

function responseSummary(value: unknown) {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value ?? "");
  return text.replace(/\s+/g, " ").slice(0, 800);
}

async function validateCanonicalSource(run: DbRun) {
  const admin = createAdminClient();
  if (!admin) throw new Error("Operator worker is not configured.");
  const workspace = await admin.from("workspaces").select("status").eq("id", run.workspace_id).maybeSingle();
  if (workspace.error) throw workspace.error;
  if (!workspace.data || !["trial", "active"].includes(workspace.data.status)) {
    return { valid: false, reason: "The workspace is no longer active." };
  }

  if (run.source_type === "booking" && run.workflow_key === "appointment-reminders") {
    const source = await admin.from("bookings")
      .select("status,booking_date,booking_time")
      .eq("workspace_id", run.workspace_id)
      .eq("id", run.source_id)
      .maybeSingle();
    if (source.error) throw source.error;
    if (!source.data || source.data.status !== "confirmed") {
      return { valid: false, reason: "The appointment is no longer confirmed." };
    }
    const startsAt = new Date(`${source.data.booking_date}T${String(source.data.booking_time).slice(0, 8)}`);
    if (!Number.isFinite(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      return { valid: false, reason: "The appointment start time has passed." };
    }
    return { valid: true, reason: "" };
  }

  if (run.source_type === "invoice" && run.workflow_key === "overdue-invoice-follow-up") {
    const source = await admin.from("invoices")
      .select("status")
      .eq("workspace_id", run.workspace_id)
      .eq("id", run.source_id)
      .maybeSingle();
    if (source.error) throw source.error;
    return source.data?.status === "overdue"
      ? { valid: true, reason: "" }
      : { valid: false, reason: "The invoice is no longer overdue." };
  }

  if (run.source_type === "message" && run.workflow_key === "new-enquiry-triage") {
    const source = await admin.from("messages")
      .select("unread,status")
      .eq("workspace_id", run.workspace_id)
      .eq("id", run.source_id)
      .maybeSingle();
    if (source.error) throw source.error;
    return source.data && (source.data.unread || ["open", "approval"].includes(source.data.status))
      ? { valid: true, reason: "" }
      : { valid: false, reason: "The enquiry no longer requires action." };
  }

  return { valid: false, reason: "The source workflow is not supported by the verified worker." };
}

async function completeRun(run: DbRun, input: {
  status: "succeeded" | "simulated" | "exception" | "failed";
  providerMode: DbRun["provider_mode"];
  providerReference?: string;
  responseCode?: number;
  summary: string;
  evidence?: Record<string, unknown>;
  verified?: boolean;
  errorCode?: string;
  errorMessage?: string;
}) {
  const admin = createAdminClient();
  if (!admin) throw new Error("Operator worker is not configured.");
  const { data, error } = await admin.rpc("complete_operator_run", {
    p_run_id: run.id,
    p_status: input.status,
    p_provider_mode: input.providerMode,
    p_provider_reference: input.providerReference ?? null,
    p_response_code: input.responseCode ?? null,
    p_response_summary: input.summary,
    p_evidence: input.evidence ?? {},
    p_verified: Boolean(input.verified),
    p_cash_protected: 0,
    p_currency: "GBP",
    p_error_code: input.errorCode ?? null,
    p_error_message: input.errorMessage ?? null,
  });
  if (error) throw error;
  return data;
}

async function retryRun(run: DbRun, input: {
  providerMode: DbRun["provider_mode"];
  providerReference?: string;
  responseCode?: number;
  summary: string;
  evidence?: Record<string, unknown>;
  errorCode: string;
  errorMessage: string;
}) {
  const admin = createAdminClient();
  if (!admin) throw new Error("Operator worker is not configured.");
  const { data, error } = await admin.rpc("retry_operator_run", {
    p_run_id: run.id,
    p_provider_mode: input.providerMode,
    p_provider_reference: input.providerReference ?? null,
    p_response_code: input.responseCode ?? null,
    p_response_summary: input.summary,
    p_evidence: input.evidence ?? {},
    p_error_code: input.errorCode,
    p_error_message: input.errorMessage,
  });
  if (error) throw error;
  return data as { status?: string } | null;
}

async function dispatchWebhook(run: DbRun) {
  const webhookUrl = process.env.OPERATOR_WEBHOOK_URL;
  const webhookSecret = process.env.OPERATOR_WEBHOOK_SECRET;
  if (!webhookUrl || !webhookSecret) {
    await completeRun(run, {
      status: "exception",
      providerMode: "webhook",
      summary: "Webhook provider is not configured.",
      errorCode: "PROVIDER_NOT_CONFIGURED",
      errorMessage: "Connect and verify an Operator webhook before enabling this workflow.",
    });
    return "exception" as const;
  }

  const target = new URL(webhookUrl);
  if (target.protocol !== "https:" && process.env.NODE_ENV === "production") {
    await completeRun(run, {
      status: "exception",
      providerMode: "webhook",
      summary: "Webhook provider must use HTTPS.",
      errorCode: "PROVIDER_URL_UNSAFE",
      errorMessage: "Connect an HTTPS Operator webhook before enabling this workflow.",
    });
    return "exception" as const;
  }

  const body = JSON.stringify({
    version: 1,
    runId: run.id,
    workspaceId: run.workspace_id,
    workflowKey: run.workflow_key,
    source: { type: run.source_type, id: run.source_id },
    idempotencyKey: run.idempotency_key,
    action: run.planned_action,
  });
  const signature = createHmac("sha256", webhookSecret).update(body).digest("hex");

  try {
    const response = await fetch(target, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": run.idempotency_key,
        "X-BDB-Signature": `sha256=${signature}`,
        "X-BDB-Run-Id": run.id,
      },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
    const responseText = await response.text();
    let providerBody: Record<string, unknown> = {};
    try {
      providerBody = responseText ? JSON.parse(responseText) as Record<string, unknown> : {};
    } catch {
      providerBody = { response: responseSummary(responseText) };
    }
    const providerReference = String(providerBody.providerId ?? providerBody.id ?? response.headers.get("x-request-id") ?? "");
    const accepted = response.ok && providerBody.accepted !== false;
    const evidence = {
      accepted,
      providerReference: providerReference || undefined,
      receivedAt: new Date().toISOString(),
      providerEvidence: providerBody.evidence ?? null,
    };

    if (accepted) {
      await completeRun(run, {
        status: "succeeded",
        providerMode: "webhook",
        providerReference,
        responseCode: response.status,
        summary: responseSummary(providerBody),
        evidence,
        verified: true,
      });
      return "succeeded" as const;
    }

    if (response.status === 429 || response.status >= 500) {
      const retried = await retryRun(run, {
        providerMode: "webhook",
        providerReference,
        responseCode: response.status,
        summary: responseSummary(providerBody),
        evidence,
        errorCode: response.status === 429 ? "PROVIDER_RATE_LIMITED" : "PROVIDER_TEMPORARY_FAILURE",
        errorMessage: `The provider returned HTTP ${response.status}; BDB OS will retry safely.`,
      });
      return retried?.status === "failed" ? "failed" as const : "retried" as const;
    }

    await completeRun(run, {
      status: "failed",
      providerMode: "webhook",
      providerReference,
      responseCode: response.status,
      summary: responseSummary(providerBody),
      evidence,
      errorCode: "PROVIDER_REJECTED",
      errorMessage: `The provider rejected the workflow with HTTP ${response.status}.`,
    });
    return "failed" as const;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Provider request failed";
    const retried = await retryRun(run, {
      providerMode: "webhook",
      summary: responseSummary(message),
      evidence: { failedAt: new Date().toISOString() },
      errorCode: "PROVIDER_UNREACHABLE",
      errorMessage: "The provider could not be reached; BDB OS will retry safely.",
    });
    return retried?.status === "failed" ? "failed" as const : "retried" as const;
  }
}

async function dispatchRun(run: DbRun) {
  const source = await validateCanonicalSource(run);
  if (!source.valid) {
    await completeRun(run, {
      status: "exception",
      providerMode: run.provider_mode,
      summary: source.reason,
      errorCode: "SOURCE_CHANGED",
      errorMessage: `${source.reason} No external action was attempted.`,
      evidence: { revalidatedAt: new Date().toISOString(), externalActionAttempted: false },
    });
    return "exception" as const;
  }

  const configuredMode = run.provider_mode === "unconfigured"
    ? process.env.OPERATOR_DEFAULT_PROVIDER_MODE
    : run.provider_mode;

  if (configuredMode === "mock") {
    const reference = `BDB-SIM-${randomUUID().slice(0, 8).toUpperCase()}`;
    await completeRun(run, {
      status: "simulated",
      providerMode: "mock",
      providerReference: reference,
      responseCode: 202,
      summary: "Simulation accepted. No external action occurred.",
      evidence: {
        simulated: true,
        providerReference: reference,
        completedAt: new Date().toISOString(),
      },
      verified: false,
    });
    return "simulated" as const;
  }

  if (configuredMode === "webhook") return dispatchWebhook(run);

  await completeRun(run, {
    status: "exception",
    providerMode: run.provider_mode,
    summary: "No verified execution provider is connected.",
    errorCode: "PROVIDER_NOT_CONFIGURED",
    errorMessage: "This workflow was returned safely because no verified provider is connected.",
  });
  return "exception" as const;
}

export async function planDueOperatorRuns(limit = 100): Promise<OperatorPlannerResult> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Operator planner is not configured.");
  const { data, error } = await admin.rpc("plan_due_operator_runs", {
    p_limit: Math.max(1, Math.min(limit, 500)),
  });
  if (error) throw error;
  const result = data as Partial<OperatorPlannerResult> | null;
  return {
    planned: Number(result?.planned ?? 0),
    prepared: Number(result?.prepared ?? 0),
    awaitingApproval: Number(result?.awaitingApproval ?? 0),
    queued: Number(result?.queued ?? 0),
  };
}

export async function processOperatorQueue(limit = 10): Promise<WorkerResult> {
  const admin = createAdminClient();
  if (!admin) throw new Error("Operator worker is not configured.");
  const workerId = `vercel-${randomUUID()}`;
  const { data, error } = await admin.rpc("claim_operator_runs", {
    p_limit: Math.max(1, Math.min(limit, 25)),
    p_worker_id: workerId,
  });
  if (error) throw error;
  const runs = (data ?? []) as DbRun[];
  const result: WorkerResult = {
    claimed: runs.length,
    succeeded: 0,
    simulated: 0,
    retried: 0,
    exceptions: 0,
    failed: 0,
  };

  for (const run of runs) {
    console.info("[operator-worker] dispatch", {
      runId: run.id,
      workspaceId: run.workspace_id,
      workflowKey: run.workflow_key,
      attempt: run.attempts,
    });
    try {
      const outcome = await dispatchRun(run);
      if (outcome === "succeeded") result.succeeded += 1;
      if (outcome === "simulated") result.simulated += 1;
      if (outcome === "retried") result.retried += 1;
      if (outcome === "exception") result.exceptions += 1;
      if (outcome === "failed") result.failed += 1;
    } catch (runError) {
      console.error("[operator-worker] unexpected run failure", {
        runId: run.id,
        error: runError instanceof Error ? runError.message : String(runError),
      });
      try {
        const recovered = await retryRun(run, {
          providerMode: run.provider_mode,
          summary: "The worker encountered an unexpected failure and scheduled a safe retry.",
          evidence: { failedAt: new Date().toISOString() },
          errorCode: "WORKER_FAILURE",
          errorMessage: "The workflow worker failed unexpectedly; BDB OS will retry safely.",
        });
        if (recovered?.status === "failed") result.failed += 1;
        else result.retried += 1;
      } catch (recoveryError) {
        console.error("[operator-worker] recovery failed", {
          runId: run.id,
          error: recoveryError instanceof Error ? recoveryError.message : String(recoveryError),
        });
        result.failed += 1;
      }
    }
  }

  console.info("[operator-worker] complete", { workerId, ...result });
  return result;
}
