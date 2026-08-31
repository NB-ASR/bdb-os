import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["create", "update", "archive", "restore"]);
const PURPOSES = new Set(["resale", "supply"]);
const STATUSES = new Set(["active", "archived"]);
const MAX_PAGE_SIZE = 200;

type ProductCommandBody = {
  workspaceId?: unknown;
  action?: unknown;
  id?: unknown;
  expectedVersion?: unknown;
  sku?: unknown;
  name?: unknown;
  barcode?: unknown;
  brand?: unknown;
  category?: unknown;
  purpose?: unknown;
  unitLabel?: unknown;
  unitCost?: unknown;
  sellingPrice?: unknown;
  vatRate?: unknown;
  reorderLevel?: unknown;
  notes?: unknown;
};

type RegisterCursor = { name: string; id: string };

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_PRODUCT_INPUT", `${field} is invalid.`);
  return result;
}

function text(value: unknown, field: string, minimum: number, maximum: number) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_PRODUCT_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) throw new CommandError("INVALID_PRODUCT_INPUT", "A product field is too long.");
  return result;
}

function numberValue(value: unknown, field: string, maximum?: number) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (maximum !== undefined && result > maximum)) {
    throw new CommandError("INVALID_PRODUCT_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalNumber(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return numberValue(value, field);
}

function expectedVersion(value: unknown) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new CommandError("INVALID_PRODUCT_VERSION", "Refresh the product before changing it.");
  }
  return result;
}

function pageSize(value: string | null) {
  if (value === null) return null;
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1 || result > MAX_PAGE_SIZE) {
    throw new CommandError("INVALID_PRODUCT_PAGE", `Product page size must be between 1 and ${MAX_PAGE_SIZE}.`);
  }
  return result;
}

function registerQuery(value: string | null) {
  const result = String(value ?? "").trim();
  if (result.length > 160) throw new CommandError("INVALID_PRODUCT_PAGE", "Product search is too long.");
  return result || null;
}

function registerStatus(value: string | null) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (!STATUSES.has(result)) throw new CommandError("INVALID_PRODUCT_PAGE", "Product status filter is invalid.");
  return result;
}

function registerPurpose(value: string | null) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (!PURPOSES.has(result)) throw new CommandError("INVALID_PRODUCT_PAGE", "Product purpose filter is invalid.");
  return result;
}

function registerCursor(afterName: string | null, afterId: string | null): RegisterCursor | null {
  if (!afterName && !afterId) return null;
  if (!afterName || !afterId || afterName.length > 160 || !UUID_PATTERN.test(afterId)) {
    throw new CommandError("INVALID_PRODUCT_PAGE", "Product continuation cursor is invalid.");
  }
  return { name: afterName, id: afterId };
}

function friendlyProductError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (error.code === "23505" || message.includes("duplicate key")) {
    return new CommandError("PRODUCT_DUPLICATE", "That SKU or barcode is already used in this workspace.", 409);
  }
  if (message.includes("changed on another device")) {
    return new CommandError("PRODUCT_CONFLICT", "This product changed on another device. Refresh before saving.", 409);
  }
  if (message.includes("access denied")) {
    return new CommandError("PRODUCT_FORBIDDEN", "You do not have permission to change Products.", 403);
  }
  if (message.includes("not found")) {
    return new CommandError("PRODUCT_NOT_FOUND", "The product could not be found.", 404);
  }
  return new CommandError("PRODUCT_COMMAND_FAILED", error.message, 400);
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const requestedPageSize = pageSize(url.searchParams.get("pageSize"));
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);

    // Preserve the legacy full-list contract for downstream callers. Catalogue
    // register screens opt into the bounded Pass 3 contract with pageSize.
    if (requestedPageSize === null) {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("status")
        .order("name");
      if (error) throw error;
      return { workspaceId, products: data ?? [] };
    }

    const query = registerQuery(url.searchParams.get("query"));
    const status = registerStatus(url.searchParams.get("status"));
    const purpose = registerPurpose(url.searchParams.get("purpose"));
    const cursor = registerCursor(url.searchParams.get("afterName"), url.searchParams.get("afterId"));
    const [pageResult, summaryResult] = await Promise.all([
      supabase.rpc("catalogue_product_page", {
        p_workspace_id: workspaceId,
        p_limit: requestedPageSize + 1,
        p_after_name: cursor?.name ?? null,
        p_after_id: cursor?.id ?? null,
        p_query: query,
        p_status: status,
        p_purpose: purpose,
      }),
      supabase.rpc("catalogue_product_summary", { p_workspace_id: workspaceId }),
    ]);
    if (pageResult.error) throw pageResult.error;
    if (summaryResult.error) throw summaryResult.error;

    const rows = pageResult.data ?? [];
    const hasMore = rows.length > requestedPageSize;
    const products = rows.slice(0, requestedPageSize);
    const last = products.at(-1) as { name?: unknown; id?: unknown } | undefined;

    return {
      workspaceId,
      products,
      hasMore,
      nextCursor: hasMore && last ? { name: String(last.name ?? ""), id: String(last.id ?? "") } : null,
      summary: summaryResult.data?.[0] ?? null,
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<ProductCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const productId = uuid(body.id, "Product ID");
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) throw new CommandError("INVALID_PRODUCT_ACTION", "Product action is invalid.");

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for product changes.");
    }

    const values = action === "create" || action === "update"
      ? {
        sku: text(body.sku, "SKU", 1, 64),
        name: text(body.name, "Product name", 2, 160),
        barcode: optionalText(body.barcode, 64),
        brand: optionalText(body.brand, 120),
        category: optionalText(body.category, 120),
        purpose: String(body.purpose ?? "").trim(),
        unitLabel: text(body.unitLabel ?? "unit", "Unit", 1, 24),
        unitCost: numberValue(body.unitCost ?? 0, "Unit cost"),
        sellingPrice: optionalNumber(body.sellingPrice, "Selling price"),
        vatRate: numberValue(body.vatRate ?? 0, "VAT rate", 100),
        reorderLevel: numberValue(body.reorderLevel ?? 0, "Reorder level"),
        notes: optionalText(body.notes, 2000),
      }
      : {
        sku: null,
        name: null,
        barcode: null,
        brand: null,
        category: null,
        purpose: null,
        unitLabel: "unit",
        unitCost: 0,
        sellingPrice: null,
        vatRate: 0,
        reorderLevel: 0,
        notes: null,
      };

    if (values.purpose !== null && !PURPOSES.has(values.purpose)) {
      throw new CommandError("INVALID_PRODUCT_INPUT", "Product purpose is invalid.");
    }

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("apply_product_command", {
      p_workspace_id: workspaceId,
      p_product_id: productId,
      p_action: action,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_expected_version: action === "create" ? null : expectedVersion(body.expectedVersion),
      p_sku: values.sku,
      p_name: values.name,
      p_barcode: values.barcode,
      p_brand: values.brand,
      p_category: values.category,
      p_purpose: values.purpose,
      p_unit_label: values.unitLabel,
      p_unit_cost: values.unitCost,
      p_selling_price: values.sellingPrice,
      p_vat_rate: values.vatRate,
      p_reorder_level: values.reorderLevel,
      p_notes: values.notes,
    });
    if (error) throw friendlyProductError(error);

    return data as Record<string, unknown>;
  });
}
