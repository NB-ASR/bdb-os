import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MOVEMENT_TYPES = new Set([
  "opening_balance",
  "purchase_receipt",
  "sale",
  "appointment_consumption",
  "customer_return",
  "supplier_return",
  "manual_adjustment",
  "write_off",
]);

type InventoryCommandBody = {
  workspaceId?: unknown;
  action?: unknown;
  id?: unknown;
  code?: unknown;
  name?: unknown;
  isDefault?: unknown;
  sku?: unknown;
  purpose?: unknown;
  unitLabel?: unknown;
  reorderPoint?: unknown;
  targetQuantity?: unknown;
  unitCost?: unknown;
  unitPrice?: unknown;
  itemId?: unknown;
  locationId?: unknown;
  movementType?: unknown;
  quantity?: unknown;
  occurredAt?: unknown;
  sourceType?: unknown;
  sourceId?: unknown;
  note?: unknown;
  metadata?: unknown;
  reversalOfId?: unknown;
  outMovementId?: unknown;
  inMovementId?: unknown;
  transferGroupId?: unknown;
  fromLocationId?: unknown;
  toLocationId?: unknown;
};

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
  if (result.length > maximum) throw new CommandError("INVALID_INVENTORY_INPUT", "Text is too long.");
  return result;
}

function uuid(value: unknown, field: string) {
  const result = String(value ?? "");
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_INVENTORY_INPUT", `${field} is invalid.`);
  return result;
}

function optionalUuid(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return null;
  return uuid(value, field);
}

function numberValue(value: unknown, field: string, options: { minimum?: number; allowZero?: boolean } = {}) {
  const result = Number(value);
  if (!Number.isFinite(result)) throw new CommandError("INVALID_INVENTORY_INPUT", `${field} must be a number.`);
  if (options.minimum !== undefined && result < options.minimum) {
    throw new CommandError("INVALID_INVENTORY_INPUT", `${field} is below the allowed minimum.`);
  }
  if (options.allowZero === false && result === 0) {
    throw new CommandError("INVALID_INVENTORY_INPUT", `${field} must be non-zero.`);
  }
  return result;
}

function objectValue(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

function inventoryAdmin() {
  const admin = createAdminClient();
  if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  return admin;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = new URL(request.url).searchParams.get("workspaceId") ?? "";
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [items, locations, balances, movements] = await Promise.all([
      supabase.from("inventory_items").select("*").eq("workspace_id", workspaceId).order("name"),
      supabase.from("inventory_locations").select("*").eq("workspace_id", workspaceId).order("is_default", { ascending: false }).order("name"),
      supabase.from("inventory_stock_balances").select("*").eq("workspace_id", workspaceId),
      supabase.from("inventory_movements").select("*").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(100),
    ]);

    const failed = [items, locations, balances, movements].find((result) => result.error);
    if (failed?.error) throw failed.error;

    return {
      workspaceId,
      items: items.data ?? [],
      locations: locations.data ?? [],
      balances: balances.data ?? [],
      movements: movements.data ?? [],
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<InventoryCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const action = text(body.action, "Action", 3, 48);
    const context = await requireWorkspaceCommand(request, workspaceId);
    const idempotencyKey = context.idempotencyKey;
    if (!idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for inventory changes.", 400);
    }

    const admin = inventoryAdmin();

    if (action === "create-location") {
      const { data, error } = await admin.rpc("create_inventory_location", {
        p_workspace_id: workspaceId,
        p_location_id: uuid(body.id, "Location ID"),
        p_code: text(body.code, "Location code", 2, 32),
        p_name: text(body.name, "Location name", 2, 120),
        p_is_default: Boolean(body.isDefault),
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
      });
      if (error) throw new CommandError("INVENTORY_LOCATION_FAILED", error.message, 400);
      return { action, location: data };
    }

    if (action === "create-item") {
      const purpose = text(body.purpose, "Item purpose", 6, 16);
      if (!new Set(["resale", "consumable"]).has(purpose)) {
        throw new CommandError("INVALID_INVENTORY_INPUT", "Item purpose is invalid.");
      }
      const reorderPoint = numberValue(body.reorderPoint ?? 0, "Reorder point", { minimum: 0 });
      const targetQuantity = numberValue(body.targetQuantity ?? 0, "Target quantity", { minimum: reorderPoint });
      const { data, error } = await admin.rpc("create_inventory_item", {
        p_workspace_id: workspaceId,
        p_item_id: uuid(body.id, "Item ID"),
        p_sku: text(body.sku, "SKU", 1, 64),
        p_name: text(body.name, "Item name", 2, 160),
        p_purpose: purpose,
        p_unit_label: text(body.unitLabel ?? "unit", "Unit", 1, 24),
        p_reorder_point: reorderPoint,
        p_target_quantity: targetQuantity,
        p_unit_cost: numberValue(body.unitCost ?? 0, "Unit cost", { minimum: 0 }),
        p_unit_price: body.unitPrice === null || body.unitPrice === undefined || body.unitPrice === ""
          ? null
          : numberValue(body.unitPrice, "Unit price", { minimum: 0 }),
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
      });
      if (error) throw new CommandError("INVENTORY_ITEM_FAILED", error.message, 400);
      return { action, item: data };
    }

    if (action === "post-movement" || action === "reverse-movement") {
      const reversalOfId = action === "reverse-movement"
        ? uuid(body.reversalOfId, "Original movement")
        : optionalUuid(body.reversalOfId, "Original movement");
      const movementType = action === "reverse-movement"
        ? "reversal"
        : text(body.movementType, "Movement type", 3, 48);
      if (action !== "reverse-movement" && !MOVEMENT_TYPES.has(movementType)) {
        throw new CommandError("INVALID_INVENTORY_INPUT", "Movement type is invalid.");
      }

      const { data, error } = await admin.rpc("post_inventory_movement", {
        p_workspace_id: workspaceId,
        p_movement_id: uuid(body.id, "Movement ID"),
        p_item_id: uuid(body.itemId, "Item"),
        p_location_id: uuid(body.locationId, "Location"),
        p_movement_type: movementType,
        p_quantity_delta: action === "reverse-movement"
          ? 1
          : numberValue(body.quantity, "Quantity", { allowZero: false }),
        p_idempotency_key: idempotencyKey,
        p_command_id: context.commandId,
        p_actor_user_id: context.userId,
        p_occurred_at: body.occurredAt ? new Date(String(body.occurredAt)).toISOString() : new Date().toISOString(),
        p_source_type: optionalText(body.sourceType, 48),
        p_source_id: optionalText(body.sourceId, 160),
        p_note: optionalText(body.note, 500),
        p_metadata: objectValue(body.metadata),
        p_reversal_of_id: reversalOfId,
      });
      if (error) throw new CommandError("INVENTORY_MOVEMENT_FAILED", error.message, 400);
      return { action, movement: data };
    }

    if (action === "transfer-stock") {
      const { data, error } = await admin.rpc("transfer_inventory_stock", {
        p_workspace_id: workspaceId,
        p_out_movement_id: uuid(body.outMovementId, "Outbound movement ID"),
        p_in_movement_id: uuid(body.inMovementId, "Inbound movement ID"),
        p_transfer_group_id: uuid(body.transferGroupId, "Transfer group ID"),
        p_item_id: uuid(body.itemId, "Item"),
        p_from_location_id: uuid(body.fromLocationId, "Source location"),
        p_to_location_id: uuid(body.toLocationId, "Destination location"),
        p_quantity: numberValue(body.quantity, "Quantity", { minimum: 0.001, allowZero: false }),
        p_idempotency_key: idempotencyKey,
        p_command_id: context.commandId,
        p_actor_user_id: context.userId,
        p_occurred_at: body.occurredAt ? new Date(String(body.occurredAt)).toISOString() : new Date().toISOString(),
        p_note: optionalText(body.note, 500),
        p_metadata: objectValue(body.metadata),
      });
      if (error) throw new CommandError("INVENTORY_TRANSFER_FAILED", error.message, 400);
      return { action, transfer: data };
    }

    throw new CommandError("UNSUPPORTED_INVENTORY_ACTION", "Unsupported inventory action.", 400);
  });
}
