import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";
import {
  businessDocumentFilename,
  renderBusinessDocumentHtml,
  renderBusinessDocumentPdf,
  type BusinessDocumentModel,
  type BusinessDocumentType,
} from "@/lib/server/business-document";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set<BusinessDocumentType>(["invoice", "credit_note", "delivery_note"]);

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_DOCUMENT_OUTPUT", `${field} is invalid.`);
  return result;
}

function text(value: unknown) {
  return value === null || value === undefined ? null : String(value);
}

function num(value: unknown) {
  return value === null || value === undefined ? null : Number(value);
}

export async function GET(request: Request) {
  const response = await runCommand(async () => {
    const url = new URL(request.url);
    const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
    const id = uuid(url.searchParams.get("id"), "Document");
    const type = String(url.searchParams.get("type") ?? "") as BusinessDocumentType;
    const format = String(url.searchParams.get("format") ?? "html");
    if (!TYPES.has(type) || !["html", "pdf"].includes(format)) throw new CommandError("INVALID_DOCUMENT_OUTPUT", "Document output request is invalid.");
    await requireWorkspaceCommand(request, workspaceId);

    const supabase = await createClient();
    const admin = createAdminClient();
    if (!supabase || !admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const [workspaceResult, settingsResult, featuresResult] = await Promise.all([
      supabase.from("workspaces").select("id,name,legal_name").eq("id", workspaceId).maybeSingle(),
      supabase.from("workspace_settings").select("email,phone,business_address,vat_number").eq("workspace_id", workspaceId).maybeSingle(),
      supabase.rpc("get_effective_features", { target_workspace_id: workspaceId }),
    ]);
    for (const result of [workspaceResult, settingsResult, featuresResult]) if (result.error) throw result.error;
    if (!workspaceResult.data) throw new CommandError("DOCUMENT_NOT_FOUND", "Business document could not be found.", 404);

    const featureMap = Object.fromEntries(((featuresResult.data ?? []) as Array<{ feature_key: string; enabled: boolean }>).map((row) => [row.feature_key, row.enabled]));
    let logoUrl: string | null = null;
    if (featureMap.custom_branding) {
      const theme = await admin.from("workspace_themes").select("client_logo_path").eq("workspace_id", workspaceId).maybeSingle();
      if (theme.error) throw theme.error;
      if (theme.data?.client_logo_path) {
        const signed = await admin.storage.from("workspace-assets").createSignedUrl(String(theme.data.client_logo_path), 900);
        if (!signed.error) logoUrl = signed.data?.signedUrl ?? null;
      }
    }

    const supplier = {
      name: String(workspaceResult.data.legal_name || workspaceResult.data.name || "Business"),
      address: text(settingsResult.data?.business_address),
      vatNumber: text(settingsResult.data?.vat_number),
      email: text(settingsResult.data?.email),
      phone: text(settingsResult.data?.phone),
    };

    let model: BusinessDocumentModel;
    if (type === "invoice") {
      const invoiceResult = await supabase
        .from("invoice_account_balances")
        .select("*")
        .eq("workspace_id", workspaceId)
        .eq("id", id)
        .maybeSingle();
      if (invoiceResult.error) throw invoiceResult.error;
      if (!invoiceResult.data) throw new CommandError("DOCUMENT_NOT_FOUND", "Invoice could not be found.", 404);
      const invoice = invoiceResult.data as Record<string, unknown>;
      const [linesResult, customerResult] = await Promise.all([
        supabase.from("invoice_lines").select("*").eq("workspace_id", workspaceId).eq("invoice_id", id).order("line_number"),
        supabase.from("customers").select("name,address,vat_number,email").eq("workspace_id", workspaceId).eq("id", String(invoice.customer_id)).maybeSingle(),
      ]);
      if (linesResult.error) throw linesResult.error;
      if (customerResult.error) throw customerResult.error;
      const issued = String(invoice.status) !== "draft";
      model = {
        type,
        title: "Invoice",
        number: String(invoice.number),
        status: String(invoice.display_status ?? invoice.status),
        issueDate: text(invoice.issued_at),
        supplyDate: text(invoice.supply_date),
        dueDate: text(invoice.due_at),
        sourceReference: text(invoice.source_sale_id),
        supplier: {
          ...supplier,
          name: issued ? String(invoice.supplier_name_snapshot || supplier.name) : supplier.name,
          address: issued ? text(invoice.supplier_address_snapshot) || supplier.address : supplier.address,
          vatNumber: issued ? text(invoice.supplier_vat_number_snapshot) || supplier.vatNumber : supplier.vatNumber,
        },
        customer: {
          name: String(invoice.customer_name_snapshot || customerResult.data?.name || "Customer"),
          address: issued ? text(invoice.customer_address_snapshot) || text(customerResult.data?.address) : text(customerResult.data?.address),
          vatNumber: issued ? text(invoice.customer_vat_number_snapshot) || text(customerResult.data?.vat_number) : text(customerResult.data?.vat_number),
          email: text(customerResult.data?.email),
        },
        lines: (linesResult.data ?? []).map((line) => ({
          code: String(line.code_snapshot), description: String(line.description_snapshot), quantity: Number(line.quantity),
          unitPrice: Number(line.unit_price), discount: Number(line.discount_amount), vatRate: Number(line.vat_rate), vatAmount: Number(line.vat_amount), total: Number(line.total_amount),
        })),
        currency: String(invoice.currency), grossAmount: num(invoice.gross_amount), discountAmount: num(invoice.discount_amount), netAmount: num(invoice.net_amount),
        vatAmount: num(invoice.vat_amount), totalAmount: num(invoice.adjusted_total_amount ?? invoice.total_amount), outstandingAmount: num(invoice.outstanding_amount),
        notes: text(invoice.notes), vatNote: text(invoice.vat_note), logoUrl,
      };
    } else if (type === "credit_note") {
      const noteResult = await supabase.from("credit_notes").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (noteResult.error) throw noteResult.error;
      if (!noteResult.data) throw new CommandError("DOCUMENT_NOT_FOUND", "Credit Note could not be found.", 404);
      const note = noteResult.data as Record<string, unknown>;
      const [linesResult, invoiceResult, customerResult] = await Promise.all([
        supabase.from("credit_note_lines").select("*").eq("workspace_id", workspaceId).eq("credit_note_id", id).order("line_number"),
        supabase.from("invoices").select("number").eq("workspace_id", workspaceId).eq("id", String(note.invoice_id)).maybeSingle(),
        supabase.from("customers").select("email").eq("workspace_id", workspaceId).eq("id", String(note.customer_id)).maybeSingle(),
      ]);
      if (linesResult.error || invoiceResult.error || customerResult.error) throw linesResult.error ?? invoiceResult.error ?? customerResult.error;
      model = {
        type, title: "Credit Note", number: String(note.number), status: String(note.status), issueDate: text(note.issue_date), sourceReference: invoiceResult.data?.number ? `Invoice ${invoiceResult.data.number}` : text(note.invoice_id),
        supplier: { ...supplier, name: String(note.supplier_name_snapshot || supplier.name), address: text(note.supplier_address_snapshot) || supplier.address, vatNumber: text(note.supplier_vat_number_snapshot) || supplier.vatNumber },
        customer: { name: String(note.customer_name_snapshot), address: text(note.customer_address_snapshot), vatNumber: text(note.customer_vat_number_snapshot), email: text(customerResult.data?.email) },
        lines: (linesResult.data ?? []).map((line) => ({ code: String(line.code_snapshot), description: String(line.description_snapshot), quantity: Number(line.quantity), unitPrice: Number(line.unit_price), discount: Number(line.discount_amount), vatRate: Number(line.vat_rate), vatAmount: Number(line.vat_amount), total: Number(line.total_amount) })),
        currency: String(note.currency), grossAmount: num(note.gross_amount), discountAmount: num(note.discount_amount), netAmount: num(note.net_amount), vatAmount: num(note.vat_amount), totalAmount: num(note.total_amount), reason: text(note.reason), notes: text(note.notes), logoUrl,
      };
    } else {
      const noteResult = await supabase.from("delivery_notes").select("*").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (noteResult.error) throw noteResult.error;
      if (!noteResult.data) throw new CommandError("DOCUMENT_NOT_FOUND", "Delivery Note could not be found.", 404);
      const note = noteResult.data as Record<string, unknown>;
      const [linesResult, customerResult] = await Promise.all([
        supabase.from("delivery_note_lines").select("*").eq("workspace_id", workspaceId).eq("delivery_note_id", id).order("line_number"),
        supabase.from("customers").select("address,vat_number,email").eq("workspace_id", workspaceId).eq("id", String(note.customer_id)).maybeSingle(),
      ]);
      if (linesResult.error || customerResult.error) throw linesResult.error ?? customerResult.error;
      model = {
        type, title: "Delivery Note", number: String(note.number), status: String(note.status), issueDate: text(note.issued_at) || text(note.delivery_date),
        sourceReference: note.source_invoice_id ? `Invoice ${String(note.source_invoice_id).slice(0, 8)}` : `Sale ${String(note.source_sale_id).slice(0, 8)}`,
        supplier: { ...supplier, name: String(note.supplier_name_snapshot || supplier.name), address: text(note.supplier_address_snapshot) || supplier.address },
        customer: { name: String(note.customer_name_snapshot), address: text(customerResult.data?.address), vatNumber: text(customerResult.data?.vat_number), email: text(customerResult.data?.email) },
        deliveryAddress: text(note.delivery_address),
        lines: (linesResult.data ?? []).map((line) => ({ code: String(line.code_snapshot), description: String(line.description_snapshot), quantity: Number(line.quantity) })),
        notes: text(note.notes), logoUrl,
      };
    }

    return { model, format, autoPrint: url.searchParams.get("print") === "1" };
  });

  if (!response.ok) return response;
  const payload = await response.json() as { result?: { model: BusinessDocumentModel; format: string; autoPrint: boolean } };
  const result = payload.result;
  if (!result) return Response.json({ error: "Business document could not be rendered." }, { status: 500 });
  const filename = businessDocumentFilename(result.model);
  if (result.format === "pdf") {
    const pdf = renderBusinessDocumentPdf(result.model);
    return new Response(new Uint8Array(pdf), {
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${filename}.pdf"`, "Cache-Control": "private, no-store" },
    });
  }
  return new Response(renderBusinessDocumentHtml(result.model, result.autoPrint), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" },
  });
}
