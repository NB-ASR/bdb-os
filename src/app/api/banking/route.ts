import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set([
  "account-create",
  "account-update",
  "account-archive",
  "reconcile",
  "reconciliation-reverse",
  "transaction-reverse",
]);

type BankingBody = Record<string, unknown> & {
  workspaceId?: unknown;
  action?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_BANKING_INPUT", `${field} is invalid.`);
  }
  return result;
}

function text(value: unknown, field: string, minimum = 1, maximum = 500) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_BANKING_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) {
    throw new CommandError("INVALID_BANKING_INPUT", "A Banking field is too long.");
  }
  return result;
}

function integer(value: unknown, field: string) {
  const result = Number(value);
  if (!Number.isInteger(result) || result <= 0) {
    throw new CommandError("INVALID_BANKING_INPUT", `${field} is invalid.`);
  }
  return result;
}

function amount(value: unknown) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0) {
    throw new CommandError("INVALID_BANKING_INPUT", "Reconciliation amount must be greater than zero.");
  }
  return result;
}

function currency(value: unknown) {
  const result = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) {
    throw new CommandError("INVALID_BANKING_INPUT", "Currency is invalid.");
  }
  return result;
}

function timestamp(value: unknown, field: string) {
  const raw = String(value ?? "").trim();
  const parsed = new Date(raw);
  if (!raw || Number.isNaN(parsed.getTime())) {
    throw new CommandError("INVALID_BANKING_INPUT", `${field} is invalid.`);
  }
  return parsed.toISOString();
}

function adminClient() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}

function friendlyError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied")) {
    return new CommandError("BANKING_FORBIDDEN", "You do not have permission to perform this Banking action.", 403);
  }
  if (message.includes("not found")) {
    return new CommandError("BANKING_NOT_FOUND", error.message, 404);
  }
  if (
    message.includes("already")
    || message.includes("exceeds")
    || message.includes("changed before")
    || message.includes("currenc")
    || message.includes("only reconcile")
    || message.includes("reverse bank")
    || message.includes("legacy bank")
    || message.includes("unavailable")
    || error.code === "23505"
  ) {
    return new CommandError("BANKING_STATE_CONFLICT", error.message, 409);
  }
  return new CommandError("BANKING_COMMAND_FAILED", error.message, 400);
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [
      accountsResult,
      summariesResult,
      importsResult,
      transactionsResult,
      allocationsResult,
      customerPaymentsResult,
      supplierPaymentsResult,
      settingsResult,
    ] = await Promise.all([
      supabase
        .from("bank_accounts")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("display_name"),
      supabase
        .from("bank_account_reconciliation_summaries")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("display_name"),
      supabase
        .from("bank_statement_imports")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("imported_at", { ascending: false }),
      supabase
        .from("bank_transaction_reconciliation_balances")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("transaction_date", { ascending: false })
        .order("created_at", { ascending: false }),
      supabase
        .from("bank_reconciliation_allocations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("occurred_at", { ascending: false }),
      supabase
        .from("customer_payment_reconciliation_balances")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("status", "posted")
        .gt("bank_unreconciled_amount", 0)
        .order("received_at", { ascending: false }),
      supabase
        .from("supplier_payment_reconciliation_balances")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("status", "posted")
        .gt("bank_unreconciled_amount", 0)
        .order("paid_at", { ascending: false }),
      supabase
        .from("workspace_settings")
        .select("currency,timezone")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);

    const failed = [
      accountsResult,
      summariesResult,
      importsResult,
      transactionsResult,
      allocationsResult,
      customerPaymentsResult,
      supplierPaymentsResult,
      settingsResult,
    ].find((result) => result.error);
    if (failed?.error) throw failed.error;

    return {
      workspaceId,
      settings: settingsResult.data ?? { currency: "EUR", timezone: "UTC" },
      accounts: accountsResult.data ?? [],
      accountSummaries: summariesResult.data ?? [],
      statementImports: importsResult.data ?? [],
      transactions: transactionsResult.data ?? [],
      allocations: allocationsResult.data ?? [],
      customerPayments: customerPaymentsResult.data ?? [],
      supplierPayments: supplierPaymentsResult.data ?? [],
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<BankingBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) {
      throw new CommandError("INVALID_BANKING_ACTION", "Banking action is invalid.");
    }

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Banking changes.");
    }

    const admin = adminClient();
    let result: { data: unknown; error: { message: string; code?: string | null } | null };

    if (action === "account-create") {
      result = await admin.rpc("create_bank_account", {
        p_workspace_id: workspaceId,
        p_bank_account_id: uuid(body.id, "Bank account ID"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_code: text(body.code, "Bank account code", 2, 32).toUpperCase(),
        p_display_name: text(body.displayName, "Bank account name", 2, 120),
        p_institution_name: text(body.institutionName, "Institution name", 2, 160),
        p_masked_identifier: optionalText(body.maskedIdentifier, 80),
        p_currency: currency(body.currency),
      });
    } else if (action === "account-update") {
      result = await admin.rpc("update_bank_account", {
        p_workspace_id: workspaceId,
        p_bank_account_id: uuid(body.accountId, "Bank account"),
        p_expected_version: integer(body.expectedVersion, "Expected version"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_display_name: text(body.displayName, "Bank account name", 2, 120),
        p_institution_name: text(body.institutionName, "Institution name", 2, 160),
        p_masked_identifier: optionalText(body.maskedIdentifier, 80),
      });
    } else if (action === "account-archive") {
      result = await admin.rpc("archive_bank_account", {
        p_workspace_id: workspaceId,
        p_bank_account_id: uuid(body.accountId, "Bank account"),
        p_expected_version: integer(body.expectedVersion, "Expected version"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
      });
    } else if (action === "reconcile") {
      const targetType = String(body.targetType ?? "").trim();
      if (!["customer_payment", "supplier_payment"].includes(targetType)) {
        throw new CommandError("INVALID_BANKING_INPUT", "Reconciliation target is invalid.");
      }
      result = await admin.rpc("reconcile_bank_transaction", {
        p_workspace_id: workspaceId,
        p_allocation_id: uuid(body.id, "Reconciliation ID"),
        p_bank_transaction_id: uuid(body.bankTransactionId, "Bank transaction"),
        p_target_type: targetType,
        p_target_payment_id: uuid(body.targetPaymentId, "Payment"),
        p_amount: amount(body.amount),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_occurred_at: body.occurredAt ? timestamp(body.occurredAt, "Reconciliation date") : new Date().toISOString(),
      });
    } else if (action === "reconciliation-reverse") {
      result = await admin.rpc("reverse_bank_reconciliation", {
        p_workspace_id: workspaceId,
        p_reversal_id: uuid(body.id, "Reconciliation reversal ID"),
        p_allocation_id: uuid(body.allocationId, "Reconciliation allocation"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_reason: text(body.reason, "Reversal reason", 5, 500),
        p_occurred_at: body.occurredAt ? timestamp(body.occurredAt, "Reversal date") : new Date().toISOString(),
      });
    } else {
      result = await admin.rpc("reverse_bank_transaction", {
        p_workspace_id: workspaceId,
        p_bank_transaction_id: uuid(body.bankTransactionId, "Bank transaction"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_reason: text(body.reason, "Reversal reason", 5, 500),
      });
    }

    if (result.error) throw friendlyError(result.error);
    return result.data as Record<string, unknown>;
  });
}
