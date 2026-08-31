import { createClient } from "@/lib/supabase/server";
import { CommandError, runCommand } from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PAGE_SIZE = 200;

type RegisterCursor = { name: string; id: string };
type SupplierOptionIdentity = { id: string };

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_PRODUCT_SUPPLIER_OPTIONS", `${field} is invalid.`);
  }
  return result;
}

function optionalUuid(value: string | null, field: string) {
  if (!value) return null;
  return uuid(value, field);
}

function pageSize(value: string | null) {
  const result = Number(value ?? 100);
  if (!Number.isInteger(result) || result < 1 || result > MAX_PAGE_SIZE) {
    throw new CommandError(
      "INVALID_PRODUCT_SUPPLIER_OPTIONS",
      `Supplier options page size must be between 1 and ${MAX_PAGE_SIZE}.`,
    );
  }
  return result;
}

function registerQuery(value: string | null) {
  const result = String(value ?? "").trim();
  if (result.length > 160) {
    throw new CommandError("INVALID_PRODUCT_SUPPLIER_OPTIONS", "Supplier search is too long.");
  }
  return result || null;
}

function registerCursor(afterName: string | null, afterId: string | null): RegisterCursor | null {
  if (!afterName && !afterId) return null;
  if (!afterName || !afterId || afterName.length > 160 || !UUID_PATTERN.test(afterId)) {
    throw new CommandError("INVALID_PRODUCT_SUPPLIER_OPTIONS", "Supplier continuation cursor is invalid.");
  }
  return { name: afterName, id: afterId };
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const productId = optionalUuid(url.searchParams.get("productId"), "Product");
    const requestedPageSize = pageSize(url.searchParams.get("pageSize"));
    const query = registerQuery(url.searchParams.get("query"));
    const cursor = registerCursor(url.searchParams.get("afterName"), url.searchParams.get("afterId"));

    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);
    }

    const pageResult = await supabase.rpc("catalogue_product_supplier_options_page", {
      p_workspace_id: workspaceId,
      p_limit: requestedPageSize + 1,
      p_after_name: cursor?.name ?? null,
      p_after_id: cursor?.id ?? null,
      p_query: query,
    });
    if (pageResult.error) throw pageResult.error;

    const rows = pageResult.data ?? [];
    const hasMore = rows.length > requestedPageSize;
    const optionSuppliers = rows.slice(0, requestedPageSize);
    const last = optionSuppliers.at(-1) as { name?: unknown; id?: unknown } | undefined;

    let linkedSuppliers: typeof optionSuppliers = [];
    if (productId) {
      const relationshipResult = await supabase
        .from("product_suppliers")
        .select("supplier_id")
        .eq("workspace_id", workspaceId)
        .eq("product_id", productId);
      if (relationshipResult.error) throw relationshipResult.error;
      const linkedIds = [...new Set((relationshipResult.data ?? []).map((row) => String(row.supplier_id)))];
      if (linkedIds.length) {
        const linkedResult = await supabase
          .from("suppliers")
          .select("*")
          .eq("workspace_id", workspaceId)
          .in("id", linkedIds);
        if (linkedResult.error) throw linkedResult.error;
        linkedSuppliers = linkedResult.data ?? [];
      }
    }

    const supplierMap = new Map<string, (typeof optionSuppliers)[number]>();
    for (const supplier of linkedSuppliers) supplierMap.set(String(supplier.id), supplier);
    for (const supplier of optionSuppliers) supplierMap.set(String(supplier.id), supplier);

    return {
      workspaceId,
      suppliers: [...supplierMap.values()],
      optionSupplierIds: optionSuppliers.map((supplier: SupplierOptionIdentity) => supplier.id),
      hasMore,
      nextCursor: hasMore && last
        ? { name: String(last.name ?? ""), id: String(last.id ?? "") }
        : null,
    };
  });
}
