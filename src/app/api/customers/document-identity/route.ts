import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CommandError, parseCommandBody, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_CUSTOMER_DOCUMENT_IDENTITY", `${field} is invalid.`);
  return result;
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<Record<string, unknown>>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const customerId = uuid(body.customerId, "Customer");
    const vatNumber = String(body.vatNumber ?? "").trim();
    if (vatNumber.length > 64) throw new CommandError("INVALID_CUSTOMER_DOCUMENT_IDENTITY", "Customer VAT number is too long.");
    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required.");
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const customerResult = await supabase.from("customers").select("*").eq("workspace_id", workspaceId).eq("id", customerId).maybeSingle();
    if (customerResult.error) throw customerResult.error;
    const customer = customerResult.data;
    if (!customer) throw new CommandError("CUSTOMER_NOT_FOUND", "Customer could not be found.", 404);
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const result = await admin.rpc("execute_customer_command", {
      p_workspace_id: workspaceId,
      p_customer_id: customerId,
      p_action: "update",
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_expected_version: customer.version,
      p_code: customer.code,
      p_name: customer.name,
      p_company: customer.company,
      p_email: customer.email,
      p_phone: customer.phone,
      p_address: customer.address,
      p_notes: null,
      p_preferences: customer.preferences ?? {},
      p_allow_duplicate: true,
      p_vat_number: vatNumber || null,
    });
    if (result.error) throw new CommandError("CUSTOMER_DOCUMENT_IDENTITY_REJECTED", result.error.message, 409);
    return result.data as Record<string, unknown>;
  });
}
