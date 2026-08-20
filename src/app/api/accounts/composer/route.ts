import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RESOURCES = new Set([
  "settings",
  "customers",
  "catalogue",
  "credit-invoice",
  "delivery-sources",
  "delivery-source",
]);

function uuid(value: string | null, field: string, nullable = false) {
  const result = String(value ?? "").trim();
  if (!result && nullable) return null;
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_ACCOUNTS_INPUT", `${field} is invalid.`);
  return result;
}

function searchTerm(value: string | null) {
  return String(value ?? "")
    .trim()
    .slice(0, 100)
    .replace(/[^\p{L}\p{N}\s./-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sourceType(value: string | null) {
  const result = String(value ?? "").trim();
  if (result !== "invoice" && result !== "sale") {
    throw new CommandError("INVALID_ACCOUNTS_INPUT", "Delivery source type is invalid.");
  }
  return result;
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace") as string;
    const resource = String(url.searchParams.get("resource") ?? "").trim();
    if (!RESOURCES.has(resource)) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Accounts composer resource is invalid.");
    await requireWorkspaceCommand(request, workspaceId);

    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    if (resource === "settings") {
      const result = await supabase
        .from("workspace_settings")
        .select("currency,business_address,vat_number,company_registration_number,payment_terms_days")
        .eq("workspace_id", workspaceId)
        .maybeSingle();
      if (result.error) throw result.error;
      return {
        workspaceId,
        settings: result.data ?? {
          currency: "EUR",
          business_address: null,
          vat_number: null,
          company_registration_number: null,
          payment_terms_days: 14,
        },
      };
    }

    if (resource === "customers") {
      const q = searchTerm(url.searchParams.get("q"));
      let query = supabase
        .from("customers")
        .select("id,code,name,company,email,address,vat_number")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .limit(25);
      if (q) {
        const pattern = `%${q}%`;
        query = query.or(`name.ilike.${pattern},code.ilike.${pattern},company.ilike.${pattern}`);
      }
      const result = await query;
      if (result.error) throw result.error;
      return { workspaceId, customers: result.data ?? [] };
    }

    if (resource === "catalogue") {
      const q = searchTerm(url.searchParams.get("q"));
      const kind = String(url.searchParams.get("kind") ?? "all").trim();
      if (!new Set(["all", "product", "service"]).has(kind)) {
        throw new CommandError("INVALID_ACCOUNTS_INPUT", "Catalogue type is invalid.");
      }

      let productsQuery = supabase
        .from("products")
        .select("id,sku,name,selling_price,vat_rate")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .limit(25);
      let servicesQuery = supabase
        .from("services")
        .select("id,code,name,price,vat_rate")
        .eq("workspace_id", workspaceId)
        .eq("status", "active")
        .order("name", { ascending: true })
        .order("id", { ascending: true })
        .limit(25);
      if (q) {
        const pattern = `%${q}%`;
        productsQuery = productsQuery.or(`sku.ilike.${pattern},name.ilike.${pattern}`);
        servicesQuery = servicesQuery.or(`code.ilike.${pattern},name.ilike.${pattern}`);
      }

      const [productsResult, servicesResult] = await Promise.all([
        kind === "service" ? Promise.resolve({ data: [], error: null }) : productsQuery,
        kind === "product" ? Promise.resolve({ data: [], error: null }) : servicesQuery,
      ]);
      if (productsResult.error) throw productsResult.error;
      if (servicesResult.error) throw servicesResult.error;
      return {
        workspaceId,
        items: [
          ...(productsResult.data ?? []).map((item) => ({
            id: item.id,
            type: "product" as const,
            code: item.sku,
            name: item.name,
            unitPrice: item.selling_price,
            vatRate: item.vat_rate,
          })),
          ...(servicesResult.data ?? []).map((item) => ({
            id: item.id,
            type: "service" as const,
            code: item.code,
            name: item.name,
            unitPrice: item.price,
            vatRate: item.vat_rate,
          })),
        ],
      };
    }

    if (resource === "credit-invoice") {
      const invoiceId = uuid(url.searchParams.get("id"), "Invoice", true);
      const number = searchTerm(url.searchParams.get("number")).toUpperCase();
      if (!invoiceId && !number) throw new CommandError("INVALID_ACCOUNTS_INPUT", "Enter an exact Invoice number.");

      let invoiceQuery = supabase
        .from("invoice_account_balances")
        .select("id,number,customer_id,customer_name_snapshot,currency,total_amount,credited_amount,adjusted_total_amount,outstanding_amount,display_status,sales_order_reference,invoice_lines(id,line_number,code_snapshot,description_snapshot,quantity,total_amount)")
        .eq("workspace_id", workspaceId)
        .gt("adjusted_total_amount", 0);
      invoiceQuery = invoiceId ? invoiceQuery.eq("id", invoiceId) : invoiceQuery.eq("number", number);
      const invoiceResult = await invoiceQuery.maybeSingle();
      if (invoiceResult.error) throw invoiceResult.error;
      if (!invoiceResult.data || ["draft", "void", "cancelled"].includes(String(invoiceResult.data.display_status))) {
        throw new CommandError("ACCOUNTS_NOT_FOUND", "No issued Invoice with value remaining matches that exact number.", 404);
      }

      const creditsResult = await supabase
        .from("credit_notes")
        .select("id,status,credit_note_lines(source_invoice_line_id,quantity)")
        .eq("workspace_id", workspaceId)
        .eq("invoice_id", String(invoiceResult.data.id))
        .eq("status", "issued");
      if (creditsResult.error) throw creditsResult.error;
      return {
        workspaceId,
        invoice: {
          ...invoiceResult.data,
          invoice_lines: [...(invoiceResult.data.invoice_lines ?? [])].sort((left, right) => Number(left.line_number) - Number(right.line_number)),
        },
        issuedCredits: creditsResult.data ?? [],
      };
    }

    if (resource === "delivery-sources") {
      const type = sourceType(url.searchParams.get("sourceType"));
      const q = searchTerm(url.searchParams.get("q"));
      if (type === "invoice") {
        let query = supabase
          .from("invoice_account_balances")
          .select("id,number,customer_id,customer_name_snapshot,issued_at")
          .eq("workspace_id", workspaceId)
          .in("display_status", ["sent", "overdue", "paid"])
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .limit(25);
        if (q) {
          const pattern = `%${q}%`;
          query = query.or(`number.ilike.${pattern},customer_name_snapshot.ilike.${pattern}`);
        }
        const result = await query;
        if (result.error) throw result.error;
        return { workspaceId, sources: result.data ?? [] };
      }

      let salesQuery = supabase
        .from("sales")
        .select("id,reference,customer_id,occurred_at,total_amount")
        .eq("workspace_id", workspaceId)
        .eq("status", "completed")
        .not("customer_id", "is", null)
        .order("occurred_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(25);
      if (q) salesQuery = salesQuery.ilike("reference", `%${q}%`);
      const salesResult = await salesQuery;
      if (salesResult.error) throw salesResult.error;
      const customerIds = [...new Set((salesResult.data ?? []).flatMap((sale) => sale.customer_id ? [sale.customer_id] : []))];
      const customersResult = customerIds.length
        ? await supabase.from("customers").select("id,name").eq("workspace_id", workspaceId).in("id", customerIds)
        : { data: [], error: null };
      if (customersResult.error) throw customersResult.error;
      const names = new Map((customersResult.data ?? []).map((customer) => [String(customer.id), String(customer.name)]));
      return {
        workspaceId,
        sources: (salesResult.data ?? []).map((sale) => ({
          ...sale,
          customer_name_snapshot: names.get(String(sale.customer_id)) ?? "Customer",
        })),
      };
    }

    const type = sourceType(url.searchParams.get("sourceType"));
    const id = uuid(url.searchParams.get("id"), type === "invoice" ? "Invoice" : "Sale") as string;
    if (type === "invoice") {
      const invoiceResult = await supabase
        .from("invoice_account_balances")
        .select("id,number,customer_id,customer_name_snapshot,invoice_lines(id,line_number,code_snapshot,description_snapshot,quantity)")
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .in("display_status", ["sent", "overdue", "paid"])
        .maybeSingle();
      if (invoiceResult.error) throw invoiceResult.error;
      if (!invoiceResult.data) throw new CommandError("ACCOUNTS_NOT_FOUND", "Invoice delivery source could not be found.", 404);
      const customerResult = await supabase
        .from("customers")
        .select("id,name,address")
        .eq("workspace_id", workspaceId)
        .eq("id", String(invoiceResult.data.customer_id))
        .maybeSingle();
      if (customerResult.error) throw customerResult.error;
      return {
        workspaceId,
        source: {
          ...invoiceResult.data,
          customer: customerResult.data,
          lines: [...(invoiceResult.data.invoice_lines ?? [])]
            .sort((left, right) => Number(left.line_number) - Number(right.line_number))
            .map((line) => ({ id: line.id, code: line.code_snapshot, description: line.description_snapshot, quantity: line.quantity })),
        },
      };
    }

    const saleResult = await supabase
      .from("sales")
      .select("id,reference,customer_id,sale_lines(id,line_number,code_snapshot,description_snapshot,quantity)")
      .eq("workspace_id", workspaceId)
      .eq("id", id)
      .eq("status", "completed")
      .maybeSingle();
    if (saleResult.error) throw saleResult.error;
    if (!saleResult.data || !saleResult.data.customer_id) throw new CommandError("ACCOUNTS_NOT_FOUND", "Sale delivery source could not be found.", 404);
    const customerResult = await supabase
      .from("customers")
      .select("id,name,address")
      .eq("workspace_id", workspaceId)
      .eq("id", String(saleResult.data.customer_id))
      .maybeSingle();
    if (customerResult.error) throw customerResult.error;
    return {
      workspaceId,
      source: {
        ...saleResult.data,
        customer: customerResult.data,
        lines: [...(saleResult.data.sale_lines ?? [])]
          .sort((left, right) => Number(left.line_number) - Number(right.line_number))
          .map((line) => ({ id: line.id, code: line.code_snapshot, description: line.description_snapshot, quantity: line.quantity })),
      },
    };
  });
}
