import { createAdminClient } from "@/lib/supabase/admin";
import {
  CommandError,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";
import {
  hashBankStatementFile,
  parseBankStatementCsv,
} from "@/lib/modules/banking-csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_FILE_BYTES = 2_000_000;

function uuid(value: FormDataEntryValue | null, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_BANK_IMPORT_INPUT", `${field} is invalid.`);
  }
  return result;
}

function friendlyError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied")) {
    return new CommandError("BANK_IMPORT_FORBIDDEN", "You do not have permission to import Bank statements.", 403);
  }
  if (
    message.includes("already")
    || message.includes("identity conflict")
    || message.includes("does not match")
    || error.code === "23505"
  ) {
    return new CommandError("BANK_IMPORT_CONFLICT", error.message, 409);
  }
  if (message.includes("not found") || message.includes("unavailable")) {
    return new CommandError("BANK_IMPORT_NOT_FOUND", error.message, 404);
  }
  return new CommandError("BANK_IMPORT_FAILED", error.message, 400);
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const form = await request.formData().catch(() => null);
    if (!form) throw new CommandError("INVALID_BANK_IMPORT_INPUT", "A valid statement upload is required.");

    const workspaceId = uuid(form.get("workspaceId"), "Workspace");
    const bankAccountId = uuid(form.get("bankAccountId"), "Bank account");
    const statementImportId = uuid(form.get("statementImportId"), "Statement import");
    const file = form.get("file");

    if (!(file instanceof File)) {
      throw new CommandError("INVALID_BANK_IMPORT_INPUT", "Select a CSV statement file.");
    }
    if (file.size <= 0 || file.size > MAX_FILE_BYTES) {
      throw new CommandError("INVALID_BANK_IMPORT_INPUT", "CSV statements must be between 1 byte and 2 MB.");
    }
    if (!file.name.toLowerCase().endsWith(".csv") && !file.name.toLowerCase().endsWith(".txt")) {
      throw new CommandError("INVALID_BANK_IMPORT_INPUT", "Only CSV or text statement files are supported.");
    }

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for statement imports.");
    }

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const accountResult = await admin
      .from("bank_accounts")
      .select("id,currency,status")
      .eq("workspace_id", workspaceId)
      .eq("id", bankAccountId)
      .maybeSingle();
    if (accountResult.error) throw accountResult.error;
    if (!accountResult.data || accountResult.data.status !== "active") {
      throw new CommandError("BANK_IMPORT_NOT_FOUND", "The Bank account is unavailable.", 404);
    }

    const content = Buffer.from(await file.arrayBuffer());
    const parsed = parseBankStatementCsv(
      content.toString("utf8"),
      accountResult.data.currency,
      bankAccountId,
    );
    const sourceFileHash = hashBankStatementFile(content);

    const result = await admin.rpc("import_bank_statement", {
      p_workspace_id: workspaceId,
      p_statement_import_id: statementImportId,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_bank_account_id: bankAccountId,
      p_source_filename: file.name,
      p_source_file_hash: sourceFileHash,
      p_rows: parsed.rows,
    });

    if (result.error) throw friendlyError(result.error);
    return {
      ...(result.data as Record<string, unknown>),
      detectedDelimiter: parsed.delimiter === "\t" ? "tab" : parsed.delimiter,
      parsedCount: parsed.rows.length,
    };
  });
}
