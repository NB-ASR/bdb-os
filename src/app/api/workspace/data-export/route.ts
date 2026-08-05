import { createClient } from "@/lib/supabase/server";
import {
  CommandError,
  requireWorkspaceCommand,
} from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AREAS = new Set(["customers", "products", "services", "suppliers", "reports"]);
const FORMATS = new Set(["csv", "json"]);

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_EXPORT_INPUT", `${field} is invalid.`);
  }
  return result;
}

function safeFilename(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "") || "workspace";
}

function csvValue(value: unknown) {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const neutralised = typeof value === "string" && /^[\u0000-\u0020]*[=+\-@]/.test(text)
    ? `'${text}`
    : text;
  return `"${neutralised.replaceAll('"', '""')}"`;
}

function toCsv(rows: Array<Record<string, unknown>>) {
  if (!rows.length) return "";
  const columns = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return [
    columns.map(csvValue).join(","),
    ...rows.map((row) => columns.map((column) => csvValue(row[column])).join(",")),
  ].join("\n");
}

function errorResponse(error: unknown) {
  if (error instanceof CommandError) {
    return Response.json(
      { ok: false, error: error.message, code: error.code },
      { status: error.status, headers: { "Cache-Control": "no-store" } },
    );
  }
  console.error("BDB OS data export failed", error);
  return Response.json(
    { ok: false, error: "The data export could not be created.", code: "EXPORT_FAILED" },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    await requireWorkspaceCommand(request, workspaceId);

    const requestedArea = String(url.searchParams.get("area") ?? "").toLowerCase();
    const requestedFormat = String(url.searchParams.get("format") ?? "").toLowerCase();
    if (!AREAS.has(requestedArea) || !FORMATS.has(requestedFormat)) {
      throw new CommandError(
        "INVALID_EXPORT_INPUT",
        "Choose Customers, Products, Services, Suppliers or Reports and CSV or JSON.",
        400,
      );
    }

    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const accessResult = await supabase.rpc("get_workspace_settings_access", {
      target_workspace_id: workspaceId,
    });
    if (accessResult.error) throw accessResult.error;
    const access = ((accessResult.data ?? []) as Array<Record<string, unknown>>)[0] ?? {};
    if (!access.can_manage || access.support_read_only) {
      throw new CommandError(
        "EXPORT_FORBIDDEN",
        "Workspace data exports require an Owner or Manager account.",
        403,
      );
    }

    const [workspaceResult, operationsResult] = await Promise.all([
      supabase.from("workspaces").select("name").eq("id", workspaceId).maybeSingle(),
      supabase
        .from("workspace_operational_settings")
        .select("archived_records_default,fiscal_year_start_month")
        .eq("workspace_id", workspaceId)
        .maybeSingle(),
    ]);
    if (workspaceResult.error) throw workspaceResult.error;
    if (operationsResult.error) throw operationsResult.error;
    if (!workspaceResult.data) throw new CommandError("EXPORT_NOT_FOUND", "Workspace not found.", 404);

    const includeArchived = url.searchParams.has("includeArchived")
      ? url.searchParams.get("includeArchived") === "true"
      : operationsResult.data?.archived_records_default === "show";

    let rows: Array<Record<string, unknown>> = [];
    if (requestedArea === "customers") {
      let query = supabase
        .from("customers")
        .select("id,code,name,company,email,phone,address,status,created_at,updated_at")
        .eq("workspace_id", workspaceId)
        .order("name");
      if (!includeArchived) query = query.neq("status", "archived");
      const result = await query;
      if (result.error) throw result.error;
      rows = (result.data ?? []) as Array<Record<string, unknown>>;
    }

    if (requestedArea === "products") {
      let query = supabase
        .from("products")
        .select("id,sku,name,barcode,brand,category,purpose,unit_label,unit_cost,selling_price,vat_rate,reorder_level,status,created_at,updated_at")
        .eq("workspace_id", workspaceId)
        .order("name");
      if (!includeArchived) query = query.neq("status", "archived");
      const result = await query;
      if (result.error) throw result.error;
      rows = (result.data ?? []) as Array<Record<string, unknown>>;
    }

    if (requestedArea === "services") {
      let query = supabase
        .from("services")
        .select("id,code,name,category,duration_minutes,preparation_buffer_minutes,recovery_buffer_minutes,price,vat_rate,booking_mode,status,created_at,updated_at")
        .eq("workspace_id", workspaceId)
        .order("name");
      if (!includeArchived) query = query.neq("status", "archived");
      const result = await query;
      if (result.error) throw result.error;
      rows = (result.data ?? []) as Array<Record<string, unknown>>;
    }

    if (requestedArea === "suppliers") {
      let query = supabase
        .from("suppliers")
        .select("id,code,name,supplier_type,contact_name,email,phone,vat_registration_number,payment_terms_days,default_discount,document_currency,categories,address_line1,postcode,country,status,created_at,updated_at")
        .eq("workspace_id", workspaceId)
        .order("name");
      if (!includeArchived) query = query.neq("status", "archived");
      const result = await query;
      if (result.error) throw result.error;
      rows = (result.data ?? []) as Array<Record<string, unknown>>;
    }

    if (requestedArea === "reports") {
      const [currencyResult, monthlyResult, customerResult, operationalResult] = await Promise.all([
        supabase.from("business_hub_currency_metrics").select("*").eq("workspace_id", workspaceId).order("currency"),
        supabase.from("business_report_monthly_sales").select("*").eq("workspace_id", workspaceId).order("month_start").order("currency"),
        supabase.from("business_report_customer_sales").select("*").eq("workspace_id", workspaceId).order("completed_sale_amount", { ascending: false }),
        supabase.from("business_hub_operational_metrics").select("*").eq("workspace_id", workspaceId).maybeSingle(),
      ]);
      for (const result of [currencyResult, monthlyResult, customerResult, operationalResult]) {
        if (result.error) throw result.error;
      }
      rows = [
        ...((currencyResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({ section: "currency", ...row })),
        ...((monthlyResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({ section: "monthly_sales", ...row })),
        ...((customerResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({ section: "customer_sales", ...row })),
        { section: "operations", ...(operationalResult.data as Record<string, unknown> ?? {}) },
      ];
    }

    const generatedAt = new Date().toISOString();
    const workspaceName = String(workspaceResult.data.name ?? "workspace");
    const filename = `${safeFilename(workspaceName)}-${requestedArea}-${generatedAt.slice(0, 10)}.${requestedFormat}`;
    const body = requestedFormat === "csv"
      ? `${toCsv(rows)}${rows.length ? "\n" : ""}`
      : `${JSON.stringify({
          format: "bdb_workspace_data_export",
          schemaVersion: 1,
          workspaceId,
          workspaceName,
          area: requestedArea,
          generatedAt,
          fiscalYearStartMonth: Number(operationsResult.data?.fiscal_year_start_month ?? 1),
          includeArchived,
          rows,
        }, null, 2)}\n`;

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": requestedFormat === "csv"
          ? "text/csv; charset=utf-8"
          : "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return errorResponse(error);
  }
}
