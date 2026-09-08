import { createAdminClient } from "@/lib/supabase/admin";
import { CommandError, parseCommandBody, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

type ReviewBody = { workspaceId?: unknown; action?: unknown; reviewId?: unknown; items?: unknown };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value: unknown, label: string) { const result = String(value ?? ""); if (!UUID.test(result)) throw new CommandError("INVALID_REVIEW", `${label} is invalid.`); return result; }

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const { data, error } = await admin.from("customer_import_review_items")
      .select("id,source_file,source_row,payload,issue_code,issue_message,created_at")
      .eq("workspace_id", workspaceId).eq("status", "pending").order("created_at").limit(500);
    if (error) throw error;
    return { items: data ?? [] };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<ReviewBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const context = await requireWorkspaceCommand(request, workspaceId);
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    if (body.action === "stage") {
      if (!Array.isArray(body.items)) throw new CommandError("INVALID_REVIEW", "Review items are invalid.");
      const { data, error } = await admin.rpc("stage_customer_import_reviews", { p_workspace_id: workspaceId, p_actor_user_id: context.userId, p_items: body.items });
      if (error) throw error;
      return { staged: Number(data ?? 0) };
    }
    if (body.action === "resolve" || body.action === "dismiss") {
      const { error } = await admin.rpc("resolve_customer_import_review", {
        p_workspace_id: workspaceId, p_actor_user_id: context.userId,
        p_review_id: uuid(body.reviewId, "Review item"), p_status: body.action === "resolve" ? "resolved" : "dismissed",
      });
      if (error) throw error;
      return { resolved: true };
    }
    throw new CommandError("INVALID_REVIEW_ACTION", "Review action is invalid.");
  });
}
