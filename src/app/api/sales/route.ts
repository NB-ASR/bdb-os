import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  parseCommandBody,
  requireWorkspaceCommand,
  runCommand,
} from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["complete", "reverse"]);
const CHANNELS = new Set(["in_store", "manual", "appointment"]);
const LINE_TYPES = new Set(["product", "service"]);

type SaleLineInput = {
  id?: unknown;
  lineType?: unknown;
  itemId?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
  discountAmount?: unknown;
};

type SaleCommandBody = Record<string, unknown> & {
  workspaceId?: unknown;
  action?: unknown;
  id?: unknown;
  customerId?: unknown;
  inventoryLocationId?: unknown;
  channel?: unknown;
  currency?: unknown;
  saleDiscount?: unknown;
  occurredAt?: unknown;
  notes?: unknown;
  reason?: unknown;
  lines?: unknown;
};

function uuid(value: unknown, field: string, nullable = false) {
  const result = String(value ?? "").trim();
  if (!result && nullable) return null;
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_SALE_INPUT", `${field} is invalid.`);
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) throw new CommandError("INVALID_SALE_INPUT", "A Sale field is too long.");
  return result;
}

function numberValue(value: unknown, field: string, maximum?: number) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || (maximum !== undefined && result > maximum)) {
    throw new CommandError("INVALID_SALE_INPUT", `${field} is invalid.`);
  }
  return result;
}

function positiveNumber(value: unknown, field: string) {
  const result = Number(value);
  if (!Number.isFinite(result) || result <= 0 || result > 100000) {
    throw new CommandError("INVALID_SALE_INPUT", `${field} is invalid.`);
  }
  return result;
}

function timestamp(value: unknown) {
  const result = String(value ?? "").trim();
  const date = new Date(result);
  if (!result || Number.isNaN(date.getTime())) {
    throw new CommandError("INVALID_SALE_INPUT", "Sale date and time are invalid.");
  }
  return date.toISOString();
}

function lines(value: unknown) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
    throw new CommandError("INVALID_SALE_LINES", "A Sale must contain between 1 and 100 lines.");
  }
  const ids = new Set<string>();
  return value.map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new CommandError("INVALID_SALE_LINES", `Sale line ${index + 1} is invalid.`);
    }
    const line = raw as SaleLineInput;
    const id = uuid(line.id, `Sale line ${index + 1} ID`) as string;
    if (ids.has(id)) throw new CommandError("INVALID_SALE_LINES", "Sale line IDs must be unique.");
    ids.add(id);
    const lineType = String(line.lineType ?? "").trim();
    if (!LINE_TYPES.has(lineType)) throw new CommandError("INVALID_SALE_LINES", `Sale line ${index + 1} type is invalid.`);
    return {
      id,
      lineType,
      itemId: uuid(line.itemId, `Sale line ${index + 1} item`) as string,
      quantity: positiveNumber(line.quantity, `Sale line ${index + 1} quantity`),
      unitPrice: numberValue(line.unitPrice, `Sale line ${index + 1} price`),
      discountAmount: numberValue(line.discountAmount ?? 0, `Sale line ${index + 1} discount`),
    };
  });
}

function friendlySaleError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (error.code === "23505" || message.includes("duplicate key")) {
    return new CommandError("SALE_DUPLICATE", "This Sale or one of its stock movements was already recorded.", 409);
  }
  if (message.includes("access denied")) {
    return new CommandError("SALE_FORBIDDEN", "You do not have permission to complete or reverse Sales.", 403);
  }
  if (message.includes("not found") || message.includes("unavailable")) {
    return new CommandError("SALE_REFERENCE_UNAVAILABLE", error.message, 409);
  }
  if (message.includes("already been reversed") || message.includes("not available for reversal")) {
    return new CommandError("SALE_ALREADY_REVERSED", "This Sale is no longer available for reversal.", 409);
  }
  if (message.includes("discount")) {
    return new CommandError("SALE_DISCOUNT_INVALID", error.message, 400);
  }
  return new CommandError("SALE_COMMAND_FAILED", error.message, 400);
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace") as string;
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);

    const [salesResult, productsResult, servicesResult, customersResult, locationsResult] = await Promise.all([
      supabase
        .from("sales")
        .select("*,sale_lines(*)")
        .eq("workspace_id", workspaceId)
        .order("occurred_at", { ascending: false }),
      supabase
        .from("products")
        .select("id,sku,name,barcode,selling_price,vat_rate,purpose,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .eq("purpose", "resale")
        .order("name"),
      supabase
        .from("services")
        .select("id,code,name,price,vat_rate,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name"),
      supabase
        .from("customers")
        .select("id,code,name,company,email,phone")
        .eq("workspace_id", workspaceId)
        .order("name"),
      supabase
        .from("inventory_locations")
        .select("id,code,name,is_default,status")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("is_default", { ascending: false })
        .order("name"),
    ]);

    const failed = [salesResult, productsResult, servicesResult, customersResult, locationsResult]
      .find((result) => result.error);
    if (failed?.error) throw failed.error;

    return {
      workspaceId,
      sales: salesResult.data ?? [],
      products: productsResult.data ?? [],
      services: servicesResult.data ?? [],
      customers: customersResult.data ?? [],
      locations: locationsResult.data ?? [],
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<SaleCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace") as string;
    const saleId = uuid(body.id, "Sale ID") as string;
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) throw new CommandError("INVALID_SALE_ACTION", "Sale action is invalid.");

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for Sale changes.");
    }

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    if (action === "reverse") {
      const reason = optionalText(body.reason, 500);
      if (!reason || reason.length < 5) {
        throw new CommandError("INVALID_SALE_REVERSAL", "Enter a clear reason for reversing this Sale.");
      }
      const { data, error } = await admin.rpc("reverse_sale", {
        p_workspace_id: workspaceId,
        p_sale_id: saleId,
        p_idempotency_key: context.idempotencyKey,
        p_actor_user_id: context.userId,
        p_command_id: context.commandId,
        p_reason: reason,
      });
      if (error) throw friendlySaleError(error);
      return data as Record<string, unknown>;
    }

    const channel = String(body.channel ?? "in_store").trim();
    if (!CHANNELS.has(channel)) throw new CommandError("INVALID_SALE_INPUT", "Sale channel is invalid.");
    const currency = String(body.currency ?? "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new CommandError("INVALID_SALE_INPUT", "Sale currency is invalid.");

    const validatedLines = lines(body.lines);
    const { data, error } = await admin.rpc("complete_sale", {
      p_workspace_id: workspaceId,
      p_sale_id: saleId,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_lines: validatedLines,
      p_currency: currency,
      p_channel: channel,
      p_customer_id: uuid(body.customerId, "Customer", true),
      p_inventory_location_id: uuid(body.inventoryLocationId, "Inventory location", true),
      p_sale_discount: numberValue(body.saleDiscount ?? 0, "Sale discount"),
      p_occurred_at: timestamp(body.occurredAt),
      p_notes: optionalText(body.notes, 1000),
    });
    if (error) throw friendlySaleError(error);

    return data as Record<string, unknown>;
  });
}
