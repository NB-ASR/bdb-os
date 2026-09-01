import { createClient } from "@/lib/supabase/server";
import { CommandError, runCommand } from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 200;

type RegisterCursor = { name: string; id: string };

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_PRODUCT_SUPPLIER_REGISTER", `${field} is invalid.`);
  }
  return result;
}

function pageSize(value: string | null) {
  const result = Number(value ?? 100);
  if (!Number.isInteger(result) || result < 1 || result > MAX_PAGE_SIZE) {
    throw new CommandError(
      "INVALID_PRODUCT_SUPPLIER_REGISTER",
      `Supplier Terms page size must be between 1 and ${MAX_PAGE_SIZE}.`,
    );
  }
  return result;
}

function registerQuery(value: string | null) {
  const result = String(value ?? "").trim();
  if (result.length > 160) {
    throw new CommandError("INVALID_PRODUCT_SUPPLIER_REGISTER", "Supplier Terms search is too long.");
  }
  return result || null;
}

function registerCursor(afterName: string | null, afterId: string | null): RegisterCursor | null {
  if (!afterName && !afterId) return null;
  if (!afterName || !afterId || afterName.length > 160 || !UUID_PATTERN.test(afterId)) {
    throw new CommandError("INVALID_PRODUCT_SUPPLIER_REGISTER", "Supplier Terms continuation cursor is invalid.");
  }
  return { name: afterName, id: afterId };
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const requestedPageSize = pageSize(url.searchParams.get("pageSize"));
    const query = registerQuery(url.searchParams.get("query"));
    const cursor = registerCursor(url.searchParams.get("afterName"), url.searchParams.get("afterId"));

    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);
    }

    const [pageResult, productSummaryResult, relationshipCountResult, preferredCountResult, supplierCountResult] = await Promise.all([
      supabase.rpc("catalogue_supplier_terms_page", {
        p_workspace_id: workspaceId,
        p_limit: requestedPageSize + 1,
        p_after_name: cursor?.name ?? null,
        p_after_id: cursor?.id ?? null,
        p_query: query,
      }),
      supabase.rpc("catalogue_product_summary", { p_workspace_id: workspaceId }),
      supabase
        .from("product_suppliers")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "active"),
      supabase
        .from("product_suppliers")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .eq("is_preferred", true),
      supabase
        .from("suppliers")
        .select("id", { count: "exact", head: true })
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .eq("supplier_type", "product"),
    ]);
    if (pageResult.error) throw pageResult.error;
    if (productSummaryResult.error) throw productSummaryResult.error;
    if (relationshipCountResult.error) throw relationshipCountResult.error;
    if (preferredCountResult.error) throw preferredCountResult.error;
    if (supplierCountResult.error) throw supplierCountResult.error;

    const rows = pageResult.data ?? [];
    const hasMore = rows.length > requestedPageSize;
    const terms = rows.slice(0, requestedPageSize);
    const last = terms.at(-1) as { name?: unknown; product_id?: unknown } | undefined;
    const productSummary = productSummaryResult.data?.[0] ?? null;

    return {
      workspaceId,
      terms,
      hasMore,
      nextCursor: hasMore && last
        ? { name: String(last.name ?? ""), id: String(last.product_id ?? "") }
        : null,
      summary: {
        activeProducts: Number(productSummary?.active_count ?? 0),
        activeRelationships: relationshipCountResult.count ?? 0,
        preferredRelationships: preferredCountResult.count ?? 0,
        productSuppliers: supplierCountResult.count ?? 0,
      },
    };
  });
}
