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
const SUPPLIER_TYPES = new Set(["product", "service", "expense"]);
const CURRENCY_PATTERN = /^[A-Z]{3}$/;

type SupplierCommandBody = {
  workspaceId?: unknown;
  action?: unknown;
  id?: unknown;
  expectedVersion?: unknown;
  code?: unknown;
  name?: unknown;
  supplierType?: unknown;
  contactName?: unknown;
  email?: unknown;
  phone?: unknown;
  vatRegistrationNumber?: unknown;
  paymentTermsDays?: unknown;
  defaultDiscount?: unknown;
  documentCurrency?: unknown;
  categories?: unknown;
  addressLine1?: unknown;
  postcode?: unknown;
  country?: unknown;
  notes?: unknown;
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_SUPPLIER_INPUT", `${field} is invalid.`);
  return result;
}

function text(value: unknown, field: string, minimum: number, maximum: number) {
  const result = String(value ?? "").trim();
  if (result.length < minimum || result.length > maximum) {
    throw new CommandError("INVALID_SUPPLIER_INPUT", `${field} is invalid.`);
  }
  return result;
}

function optionalText(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return null;
  if (result.length > maximum) throw new CommandError("INVALID_SUPPLIER_INPUT", "A supplier field is too long.");
  return result;
}

function numberValue(value: unknown, field: string, maximum: number, integer = false) {
  const result = Number(value);
  if (!Number.isFinite(result) || result < 0 || result > maximum || (integer && !Number.isInteger(result))) {
    throw new CommandError("INVALID_SUPPLIER_INPUT", `${field} is invalid.`);
  }
  return result;
}

function expectedVersion(value: unknown) {
  const result = Number(value);
  if (!Number.isInteger(result) || result < 1) {
    throw new CommandError("INVALID_SUPPLIER_VERSION", "Refresh the supplier before changing it.");
  }
  return result;
}

function categories(value: unknown) {
  if (!Array.isArray(value)) return [];
  if (value.length > 20) throw new CommandError("INVALID_SUPPLIER_INPUT", "Too many supplier categories were provided.");
  const normalized = [...new Set(value.map((item) => String(item).trim()).filter(Boolean))];
  if (normalized.some((item) => item.length > 80)) {
    throw new CommandError("INVALID_SUPPLIER_INPUT", "A supplier category is too long.");
  }
  return normalized;
}

function currency(value: unknown) {
  const result = String(value ?? "").trim().toUpperCase();
  if (!CURRENCY_PATTERN.test(result)) {
    throw new CommandError("INVALID_SUPPLIER_INPUT", "Document currency is invalid.");
  }
  return result;
}

function friendlySupplierError(error: { message: string; code?: string | null }) {
  const message = error.message.toLowerCase();
  if (error.code === "23505" || message.includes("duplicate key")) {
    return new CommandError("SUPPLIER_DUPLICATE", "That supplier code is already used in this workspace.", 409);
  }
  if (message.includes("changed on another device")) {
    return new CommandError("SUPPLIER_CONFLICT", "This supplier changed on another device. Refresh before saving.", 409);
  }
  if (message.includes("access denied")) {
    return new CommandError("SUPPLIER_FORBIDDEN", "You do not have permission to change Suppliers.", 403);
  }
  if (message.includes("not found")) {
    return new CommandError("SUPPLIER_NOT_FOUND", "The supplier could not be found.", 404);
  }
  return new CommandError("SUPPLIER_COMMAND_FAILED", error.message, 400);
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"), "Workspace");
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data: userData, error: userError } = await supabase.auth.getUser();
    if (userError || !userData.user) throw new CommandError("UNAUTHENTICATED", "Sign in again to continue.", 401);

    const { data, error } = await supabase
      .from("suppliers")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("status")
      .order("name");
    if (error) throw error;

    return { workspaceId, suppliers: data ?? [] };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<SupplierCommandBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const supplierId = uuid(body.id, "Supplier ID");
    const action = String(body.action ?? "").trim();
    if (!ACTIONS.has(action)) throw new CommandError("INVALID_SUPPLIER_ACTION", "Supplier action is invalid.");

    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) {
      throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required for supplier changes.");
    }

    const values = action === "create" || action === "update"
      ? {
        code: text(body.code, "Supplier code", 1, 64),
        name: text(body.name, "Supplier name", 2, 160),
        supplierType: String(body.supplierType ?? "").trim(),
        contactName: optionalText(body.contactName, 160),
        email: optionalText(body.email, 254)?.toLowerCase() ?? null,
        phone: optionalText(body.phone, 64),
        vatRegistrationNumber: optionalText(body.vatRegistrationNumber, 80),
        paymentTermsDays: numberValue(body.paymentTermsDays ?? 0, "Payment terms", 365, true),
        defaultDiscount: numberValue(body.defaultDiscount ?? 0, "Default discount", 100),
        documentCurrency: currency(body.documentCurrency),
        categories: categories(body.categories),
        addressLine1: optionalText(body.addressLine1, 240),
        postcode: optionalText(body.postcode, 32),
        country: optionalText(body.country, 120),
        notes: optionalText(body.notes, 2000),
      }
      : {
        code: null,
        name: null,
        supplierType: null,
        contactName: null,
        email: null,
        phone: null,
        vatRegistrationNumber: null,
        paymentTermsDays: 0,
        defaultDiscount: 0,
        documentCurrency: "EUR",
        categories: [] as string[],
        addressLine1: null,
        postcode: null,
        country: null,
        notes: null,
      };

    if (values.supplierType !== null && !SUPPLIER_TYPES.has(values.supplierType)) {
      throw new CommandError("INVALID_SUPPLIER_INPUT", "Supplier type is invalid.");
    }

    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const { data, error } = await admin.rpc("apply_supplier_command", {
      p_workspace_id: workspaceId,
      p_supplier_id: supplierId,
      p_action: action,
      p_idempotency_key: context.idempotencyKey,
      p_actor_user_id: context.userId,
      p_command_id: context.commandId,
      p_expected_version: action === "create" ? null : expectedVersion(body.expectedVersion),
      p_code: values.code,
      p_name: values.name,
      p_supplier_type: values.supplierType,
      p_contact_name: values.contactName,
      p_email: values.email,
      p_phone: values.phone,
      p_vat_registration_number: values.vatRegistrationNumber,
      p_payment_terms_days: values.paymentTermsDays,
      p_default_discount: values.defaultDiscount,
      p_document_currency: values.documentCurrency,
      p_categories: values.categories,
      p_address_line1: values.addressLine1,
      p_postcode: values.postcode,
      p_country: values.country,
      p_notes: values.notes,
    });
    if (error) throw friendlySupplierError(error);

    return data as Record<string, unknown>;
  });
}
