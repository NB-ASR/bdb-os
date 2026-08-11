import { normaliseInventoryMovementDelta, type InventoryMovementType } from "@/lib/modules/inventory";
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
const MANUAL_MOVEMENT_TYPES = new Set<InventoryMovementType>([
  "opening_balance",
  "internal_consumption",
  "manual_adjustment",
  "stocktake_correction",
  "write_off",
]);

type InventoryCommandBody = Record<string, unknown> & {
  workspaceId?: unknown;
  action?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_INVENTORY_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalUuid(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return uuid(value, field);
}

function text(value: unknown, field: string, minimum = 1, maximum = 160) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_INVENTORY_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalText(value: unknown, maximum = 500) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) {
    throw new CommandError("INVALID_INVENTORY_INPUT", "Text is too long.");
  }
  return result;
}

function numberValue(
  value: unknown,
  field: string,
  options: { minimum?: number; allowZero?: boolean } = {},
) {
  const result = Number(value);
  if (!Number.isFinite(result)) {
    throw new CommandError("INVALID_INVENTORY_INPUT", `${field} must be a number.`);
  }
  if (options.minimum !== undefined && result < options.minimum) {
    throw new CommandError("INVALID_INVENTORY_INPUT", `${field} is below the allowed minimum.`);
  }
  if (options.allowZero === false && result === 0) {
    throw new CommandError("INVALID_INVENTORY_INPUT", `${field} must be non-zero.`);
  }
  return result;
}

function optionalNumber(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return numberValue(value, field, { minimum: 0 });
}

function occurredAt(value: unknown) {
  if (value === null || value === undefined || value === "") return new Date().toISOString();
  const parsed = new Date(String(value));
  if (!Number.isFinite(parsed.getTime())) {
    throw new CommandError("INVALID_INVENTORY_INPUT", "Movement date is invalid.");
  }
  return parsed.toISOString();
}

function objectValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function friendlyInventoryError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (message.includes("access denied") || message.includes("posting access denied")) {
    return new CommandError("INVENTORY_FORBIDDEN", "You do not have permission to change Inventory.", 403);
  }
  if (message.includes("changed on another device")) {
    return new CommandError("INVENTORY_CONFLICT", error.message, 409);
  }
  if (
    message.includes("already been reversed")
    || message.includes("not ready")
    || message.includes("cannot be archived")
  ) {
    return new CommandError("INVENTORY_STATE_CONFLICT", error.message, 409);
  }
  if (error.code === "23505" || message.includes("duplicate key")) {
    return new CommandError("INVENTORY_DUPLICATE", "This Inventory command conflicts with an existing record.", 409);
  }
  return new CommandError("INVENTORY_COMMAND_FAILED", error.message, 400);
}

function adminClient() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [products, locations, balances, movements, documents, suppliers] = await Promise.all([
      supabase
        .from("products")
        .select("id,workspace_id,sku,name,barcode,brand,category,purpose,unit_label,unit_cost,selling_price,reorder_level,status")
        .eq("workspace_id", workspaceId)
        .order("name"),
      supabase
        .from("inventory_locations")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("is_default", { ascending: false })
        .order("name"),
      supabase
        .from("inventory_stock_balances")
        .select("*")
        .eq("workspace_id", workspaceId),
      supabase
        .from("inventory_movements")
        .select("*")
        .eq("workspace_id", workspaceId)
        .order("occurred_at", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(300),
      supabase
        .from("supplier_documents")
        .select("id,workspace_id,supplier_id,document_type,document_number,document_date,currency,status,inventory_posting_status,inventory_location_id,inventory_posted_at,inventory_reversed_at,version,file_name")
        .eq("workspace_id", workspaceId)
        .eq("status", "approved")
        .in("inventory_posting_status", ["ready", "posted", "reversed"])
        .order("approved_at", { ascending: false }),
      supabase
        .from("suppliers")
        .select("id,code,name")
        .eq("workspace_id", workspaceId),
    ]);

    const failed = [products, locations, balances, movements, documents, suppliers]
      .find((result) => result.error);
    if (failed?.error) throw failed.error;

    const supplierMap = new Map((suppliers.data ?? []).map((supplier) => [supplier.id, supplier]));
    return {
      workspaceId,
      products: products.data ?? [],
      locations: locations.data ?? [],
      balances: balances.data ?? [],
      movements: movements.data ?? [],
      purchasingDocuments: (documents.data ?? []).map((document) => ({
        ...document,
        supplier: document.supplier_id ? supplierMap.get(document.supplier_id) ?? null : null,
      })),
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<InventoryCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const action = text(body.action, "Action", 3, 48);
    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError(
        "IDEMPOTENCY_REQUIRED",
        "An idempotency key is required for Inventory changes.",
      );
    }
    const admin = adminClient();

    if (["create-location", "update-location", "archive-location", "restore-location"].includes(action)) {
      const rpcAction = action.replace("-location", "");
      const result = await admin.rpc("apply_inventory_location_command", {
        p_workspace_id: workspaceId,
        p_location_id: uuid(body.id, "Location ID"),
        p_action: rpcAction,
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_expected_version: body.expectedVersion === null || body.expectedVersion === undefined
          ? null
          : numberValue(body.expectedVersion, "Expected version", { minimum: 1 }),
        p_code: ["create", "update"].includes(rpcAction)
          ? text(body.code, "Location code", 1, 32)
          : null,
        p_name: ["create", "update"].includes(rpcAction)
          ? text(body.name, "Location name", 2, 120)
          : null,
        p_is_default: Boolean(body.isDefault),
      });
      if (result.error) throw friendlyInventoryError(result.error);
      return result.data as Record<string, unknown>;
    }

    if (action === "post-movement" || action === "reverse-movement") {
      const reversing = action === "reverse-movement";
      const movementType = reversing
        ? "reversal"
        : text(body.movementType, "Movement type", 3, 48) as InventoryMovementType;
      if (!reversing && !MANUAL_MOVEMENT_TYPES.has(movementType)) {
        throw new CommandError(
          "INVALID_INVENTORY_INPUT",
          "Purchasing, Sales and Appointment movements must be posted from their owning records.",
        );
      }
      const sourceType = optionalText(body.sourceType, 48);
      if (!reversing && sourceType) {
        throw new CommandError(
          "INVALID_INVENTORY_INPUT",
          "Manual Inventory changes cannot claim a Purchasing, Sales or Appointment source record.",
        );
      }
      const requestedQuantity = reversing
        ? 1
        : numberValue(body.quantity, "Quantity", { allowZero: false });
      const quantityDelta = reversing
        ? 1
        : normaliseInventoryMovementDelta(movementType, requestedQuantity);
      const result = await admin.rpc("post_inventory_movement", {
        p_workspace_id: workspaceId,
        p_movement_id: uuid(body.id, "Movement ID"),
        p_product_id: uuid(body.productId, "Product"),
        p_location_id: uuid(body.locationId, "Location"),
        p_movement_type: movementType,
        p_quantity_delta: quantityDelta,
        p_idempotency_key: context.idempotencyKey,
        p_command_id: context.commandId,
        p_actor_user_id: context.userId,
        p_occurred_at: occurredAt(body.occurredAt),
        p_unit_cost: optionalNumber(body.unitCost, "Unit cost"),
        p_currency: body.currency ? text(body.currency, "Currency", 3, 3).toUpperCase() : null,
        p_source_type: sourceType,
        p_source_id: optionalText(body.sourceId, 160),
        p_note: optionalText(body.note, 500),
        p_metadata: objectValue(body.metadata),
        p_reversal_of_id: reversing
          ? uuid(body.reversalOfId, "Original movement")
          : optionalUuid(body.reversalOfId, "Original movement"),
      });
      if (result.error) throw friendlyInventoryError(result.error);
      return result.data as Record<string, unknown>;
    }

    if (action === "transfer-stock") {
      const result = await admin.rpc("transfer_inventory_stock", {
        p_workspace_id: workspaceId,
        p_out_movement_id: uuid(body.outMovementId, "Outbound movement ID"),
        p_in_movement_id: uuid(body.inMovementId, "Inbound movement ID"),
        p_transfer_group_id: uuid(body.transferGroupId, "Transfer group ID"),
        p_product_id: uuid(body.productId, "Product"),
        p_from_location_id: uuid(body.fromLocationId, "Source location"),
        p_to_location_id: uuid(body.toLocationId, "Destination location"),
        p_quantity: numberValue(body.quantity, "Quantity", { minimum: 0.001, allowZero: false }),
        p_idempotency_key: context.idempotencyKey,
        p_command_id: context.commandId,
        p_actor_user_id: context.userId,
        p_occurred_at: occurredAt(body.occurredAt),
        p_note: optionalText(body.note, 500),
        p_metadata: objectValue(body.metadata),
      });
      if (result.error) throw friendlyInventoryError(result.error);
      return result.data as Record<string, unknown>;
    }

    if (action === "post-purchasing-document") {
      const result = await admin.rpc("post_supplier_document_to_inventory", {
        p_workspace_id: workspaceId,
        p_document_id: uuid(body.documentId, "Supplier document"),
        p_location_id: uuid(body.locationId, "Inventory location"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
      });
      if (result.error) throw friendlyInventoryError(result.error);
      return result.data as Record<string, unknown>;
    }

    if (action === "reverse-purchasing-document") {
      const result = await admin.rpc("reverse_supplier_document_inventory", {
        p_workspace_id: workspaceId,
        p_document_id: uuid(body.documentId, "Supplier document"),
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_reason: text(body.reason, "Reversal reason", 5, 500),
      });
      if (result.error) throw friendlyInventoryError(result.error);
      return result.data as Record<string, unknown>;
    }

    throw new CommandError("UNSUPPORTED_INVENTORY_ACTION", "Unsupported Inventory action.");
  });
}
