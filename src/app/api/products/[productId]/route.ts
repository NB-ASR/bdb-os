import { createClient } from "@/lib/supabase/server";
import { CommandError, runCommand } from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_PRODUCT_INPUT", `${field} is invalid.`);
  return result;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ productId: string }> },
) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    const { productId: rawProductId } = await context.params;
    const productId = uuid(rawProductId, "Product ID");
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);

    const { data, error } = await supabase
      .from("products")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("id", productId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new CommandError("PRODUCT_NOT_FOUND", "The product could not be found.", 404);

    return { workspaceId, product: data };
  });
}
