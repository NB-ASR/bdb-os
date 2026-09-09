import { createClient as createAuthClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CommandError, parseCommandBody, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

type DeleteBody = { workspaceId?: unknown; customerId?: unknown; expectedVersion?: unknown; email?: unknown; password?: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown, label: string) { const result = String(value ?? ""); if (!UUID.test(result)) throw new CommandError("INVALID_DELETE", `${label} is invalid.`); return result; }

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<DeleteBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) throw new CommandError("IDEMPOTENCY_KEY_REQUIRED", "A deletion retry key is required.");
    if (context.role !== "owner") throw new CommandError("OWNER_REQUIRED", "Only the workspace owner can delete Customers.", 403);
    const supabase = await createClient();
    const { data: userData } = await supabase!.auth.getUser();
    const actualEmail = userData.user?.email?.trim().toLowerCase();
    const enteredEmail = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!actualEmail || enteredEmail !== actualEmail) throw new CommandError("DELETE_CONFIRMATION_FAILED", "Enter the exact signed-in owner email.", 403);
    if (!password || password.length > 256) throw new CommandError("DELETE_CONFIRMATION_FAILED", "Enter your current password.", 403);
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const verifier = createAuthClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
    const { data: verified, error: verificationError } = await verifier.auth.signInWithPassword({ email: actualEmail, password });
    if (verificationError || verified.user?.id !== context.userId) throw new CommandError("DELETE_CONFIRMATION_FAILED", "Password verification failed.", 403);
    const expectedVersion = Number(body.expectedVersion);
    if (!Number.isInteger(expectedVersion) || expectedVersion < 1) throw new CommandError("INVALID_DELETE", "Refresh the Customer before deleting it.");
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const { error } = await admin.rpc("delete_archived_customer", {
      p_workspace_id: workspaceId, p_actor_user_id: context.userId,
      p_customer_id: uuid(body.customerId, "Customer"), p_expected_version: expectedVersion,
      p_idempotency_key: context.idempotencyKey,
    });
    if (error) {
      const message = error.message.toLowerCase();
      if (message.includes("linked business history")) throw new CommandError("CUSTOMER_DELETE_BLOCKED", "This Customer has linked business history and must remain archived.", 409);
      throw error;
    }
    return { deleted: true };
  });
}
