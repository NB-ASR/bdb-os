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

interface ProductSupplierCommandBody {
  workspaceId?: unknown;
  action?: unknown;
  id?: unknown;
  expectedVersion?: unknown;
  productId?: unknown;
  supplierId?: unknown;
  supplierSku?: unknown;
  supplierCost?: unknown;
  currency?: unknown;
  isPreferred?: unknown;
  leadTimeDays?: unknown;
  minimumOrderQuantity?: unknown;
  notes?: unknown;
}

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_PRODUCT_SUPPLIER_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalUuid(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return uuid(value, field);
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) {
    throw new CommandError("INVALID_PRODUCT_SUPPLIER_INPUT", "A Product Supplier field is too long.");
  }
  return result;
}

function currency(value: unknown) {
  const result = String(value ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(result)) {
    throw new CommandError("INVALID_PRODUCT_SUPPLIER_INPUT", "Currency must be a three-letter code.");
  }
  return result;
}

function numberValue(value: unknown, field: string, options?: { minimum?: number; maximum?: number; integer?: boolean }) {
  const result = Number(value);
  const minimum = options?.minimum ?? 0;
  if (!Number.isFinite(result)
    || result < minimum
    || (options?.maximum !== undefined && result > options.maximum)
    || (options?.integer && !Number.isInteger(result))) {
    throw new CommandError("INVALID_PRODUCT_SUPPLIER_INPUT", `${field} is invalid.`);
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
    throw new CommandError(
      "INVALID_PRODUCT_SUPPLIER_VERSION",
      "Refresh the Product Supplier relationship before changing it.",
    );
  }
  return result;
}

function friendlyError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("product_suppliers_preferred_product_idx")) {
    return new CommandError(
      "PRODUCT_SUPPLIER_PREFERRED_EXISTS",
      "This Product already has an active preferred supplier. Remove that preference before assigning another.",
      409,
    );
  }
  if (message.includes("product_suppliers_supplier_sku_idx")) {
    return new CommandError(
      "PRODUCT_SUPPLIER_SKU_DUPLICATE",
      "That Supplier SKU is already used for another Product from this Supplier.",
      409,
    );
  }
  if (error.code === "23505" || message.includes("duplicate key")) {
    return new CommandError(
      "PRODUCT_SUPPLIER_DUPLICATE",
      "This Supplier is already linked to the Product.",
      409,
    );
  }
  if (message.includes("changed on another device")) {
    return new CommandError(
      "PRODUCT_SUPPLIER_CONFLICT",
      "This relationship changed on another device. Refresh before saving.",
      409,
    );
  }
  if (message.includes("write access denied")) {
    return new CommandError(
      "PRODUCT_SUPPLIER_FORBIDDEN",
      "You need Product view and Supplier edit access to manage this relationship.",
      403,
    );
  }
  if (message.includes("archived products") || message.includes("archived suppliers")) {
    return new CommandError(
      "PRODUCT_SUPPLIER_ARCHIVED_RECORD",
      "Restore the Product and Supplier before activating this relationship.",
      409,
    );
  }
  if (message.includes("only product suppliers")) {
    return new CommandError(
      "PRODUCT_SUPPLIER_TYPE_INVALID",
      "Only Suppliers classified as Product suppliers can be linked.",
      409,
    );
  }
  if (message.includes("identities cannot be changed")) {
    return new CommandError(
      "PRODUCT_SUPPLIER_IDENTITY_IMMUTABLE",
      "Archive this relationship and create another instead of changing its Product or Supplier.",
      409,
    );
  }
  if (message.includes("not found")) {
    return new CommandError(
      "PRODUCT_SUPPLIER_NOT_FOUND",
      "The Product, Supplier or relationship could not be found.",
      404,
    );
  }
  return new CommandError("PRODUCT_SUPPLIER_COMMAND_FAILED", error.message, 400);
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const productId = optionalUuid(url.searchParams.get("productId"), "Product");
    const supplierId = optionalUuid(url.searchParams.get("supplierId"), "Supplier");
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) {
      throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);
    }

    let query = supabase
      .from("product_suppliers")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("status")
      .order("is_preferred", { ascending: false })
      .order("created_at");
    if (productId) query = query.eq("product_id", productId);
    if (supplierId) query = query.eq("supplier_id", supplierId);

    const { data, error } = await query;
    if (error) throw error;

    return { workspaceId, relationships: data ?? [] };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<ProductSupplierCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const relationshipId = uuid(body.id, "Relationship ID");
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) {
      throw new CommandError("INVALID_PRODUCT_SUPPLIER_ACTION", "Product Supplier action is invalid.");
    }

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError(
        "IDEMPOTENCY_REQUIRED",
        "An idempotency key is required for Product Supplier changes.",
      );
    }

    const requiresValues = action === "create" || action === "update" || action === "restore";
    const values = requiresValues
      ? {
        productId: uuid(body.productId, "Product"),
        supplierId: uuid(body.supplierId, "Supplier"),
        supplierSku: optionalText(body.supplierSku, 64),
        supplierCost: optionalNumber(body.supplierCost, "Supplier cost"),
        currency: currency(body.currency ?? "EUR"),
        isPreferred: Boolean(body.isPreferred),
        leadTimeDays: numberValue(body.leadTimeDays ?? 0, "Lead time", { maximum: 3650, integer: true }),
        minimumOrderQuantity: numberValue(
          body.minimumOrderQuantity ?? 1,
          "Minimum order quantity",
          { minimum: Number.EPSILON },
        ),
        notes: optionalText(body.notes, 2000),
      }
      : {
        productId: null,
        supplierId: null,
        supplierSku: null,
        supplierCost: null,
        currency: "EUR",
        isPreferred: false,
        leadTimeDays: 0,
        minimumOrderQuantity: 1,
        notes: null,
      };

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("apply_product_supplier_command", {
      p_workspace_id: workspaceId,
      p_relationship_id: relationshipId,
      p_action: action,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_expected_version: action === "create" ? null : expectedVersion(body.expectedVersion),
      p_product_id: values.productId,
      p_supplier_id: values.supplierId,
      p_supplier_sku: values.supplierSku,
      p_supplier_cost: values.supplierCost,
      p_currency: values.currency,
      p_is_preferred: values.isPreferred,
      p_lead_time_days: values.leadTimeDays,
      p_minimum_order_quantity: values.minimumOrderQuantity,
      p_notes: values.notes,
    });
    if (error) throw friendlyError(error);

    return data as Record<string, unknown>;
  });
}
