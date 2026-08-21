import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { formatDocumentDate } from "@/lib/format";
import { CommandError, requireWorkspaceCommand, runCommand } from "@/lib/server/command";
import {
  businessDocumentHtml,
  businessDocumentPdf,
  type BusinessDocumentKind,
  type BusinessDocumentLine,
  type BusinessDocumentModel,
} from "@/lib/server/business-document-render";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set<BusinessDocumentKind>(["invoice", "credit_note", "delivery_note"]);

function uuid(value: string | null, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_BUSINESS_DOCUMENT_INPUT", `${field} is invalid.`);
  return result;
}
function num(value: unknown) { return value === null || value === undefined ? null : Number(value); }
function text(value: unknown) { return String(value ?? ""); }
function permanentValue(snapshotReady: boolean, snapshot: unknown, live: unknown) {
  return text(snapshotReady ? snapshot : live);
}
function discountPercent(line: Record<string, unknown>) {
  const gross = Number(line.gross_amount ?? (Number(line.quantity ?? 0) * Number(line.unit_price ?? 0)));
  const discount = Number(line.discount_amount ?? 0);
  if (!Number.isFinite(gross) || gross <= 0 || !Number.isFinite(discount) || discount <= 0) return 0;
  return Math.round((discount / gross) * 10000) / 100;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const workspaceId = uuid(url.searchParams.get("workspaceId"), "Workspace");
  const id = uuid(url.searchParams.get("id"), "Document");
  const type = String(url.searchParams.get("type") ?? "") as BusinessDocumentKind;
  const format = String(url.searchParams.get("format") ?? "html");
  if (!TYPES.has(type)) return Response.json({ error: "Business document type is invalid." }, { status: 400 });

  const result = await runCommand(async () => {
    await requireWorkspaceCommand(request, workspaceId);
    const supabase = await createClient();
    if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const [workspaceResult, settingsResult, featureResult] = await Promise.all([
      supabase.from("workspaces").select("id,name,legal_name").eq("id", workspaceId).maybeSingle(),
      supabase.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
      supabase.rpc("get_effective_features", { target_workspace_id: workspaceId }),
    ]);
    if (workspaceResult.error) throw workspaceResult.error;
    if (settingsResult.error) throw settingsResult.error;
    if (featureResult.error) throw featureResult.error;
    if (!workspaceResult.data) throw new CommandError("BUSINESS_DOCUMENT_NOT_FOUND", "Workspace could not be found.", 404);

    const settings = (settingsResult.data ?? {}) as Record<string, unknown>;
    const liveSupplierName = workspaceResult.data.legal_name ?? workspaceResult.data.name;
    let model: BusinessDocumentModel;
    let logoSnapshotPath: string | null = null;

    if (type === "invoice") {
      const invoiceResult = await supabase.from("invoice_account_balances").select("*,invoice_lines(*)").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (invoiceResult.error) throw invoiceResult.error;
      const row = invoiceResult.data as Record<string, unknown> | null;
      if (!row) throw new CommandError("BUSINESS_DOCUMENT_NOT_FOUND", "Invoice could not be found.", 404);
      const draft = String(row.status) === "draft";
      const snapshotReady = !draft && Boolean(row.document_permanence_snapshot_at);
      logoSnapshotPath = text(row.supplier_logo_path_snapshot) || null;
      const customerResult = await supabase.from("customers").select("name,address,vat_number").eq("workspace_id", workspaceId).eq("id", String(row.customer_id)).maybeSingle();
      if (customerResult.error) throw customerResult.error;
      const lines = ((row.invoice_lines ?? []) as Array<Record<string, unknown>>).sort((a, b) => Number(a.line_number) - Number(b.line_number));
      model = {
        kind: "invoice", title: "Invoice", number: String(row.number), draft,
        date: formatDocumentDate(String(row.issued_at)), supplyDate: row.supply_date ? formatDocumentDate(String(row.supply_date)) : null,
        description: text(row.description) || null,
        salesOrderReference: text(row.sales_order_reference) || null,
        currency: String(row.currency),
        supplier: {
          name: permanentValue(snapshotReady, row.supplier_name_snapshot, liveSupplierName) || "Supplier",
          address: permanentValue(snapshotReady, row.supplier_address_snapshot, settings.business_address) || null,
          vatNumber: permanentValue(snapshotReady, row.supplier_vat_number_snapshot, settings.vat_number) || null,
          registrationNumber: permanentValue(snapshotReady, row.supplier_registration_number_snapshot, settings.company_registration_number) || null,
          email: permanentValue(snapshotReady, row.supplier_email_snapshot, settings.email) || null,
          phone: permanentValue(snapshotReady, row.supplier_phone_snapshot, settings.phone) || null,
        },
        customer: {
          name: permanentValue(snapshotReady, row.customer_name_snapshot, customerResult.data?.name) || "Customer",
          address: permanentValue(snapshotReady, row.customer_address_snapshot, customerResult.data?.address) || null,
          vatNumber: permanentValue(snapshotReady, row.customer_vat_number_snapshot, customerResult.data?.vat_number) || null,
        },
        lines: lines.map((line): BusinessDocumentLine => ({
          code: String(line.code_snapshot), description: String(line.description_snapshot), quantity: Number(line.quantity),
          unitPrice: num(line.unit_price), discountAmount: num(line.discount_amount), discountPercent: discountPercent(line),
          netAmount: num(line.net_amount), vatRate: num(line.vat_rate), vatAmount: num(line.vat_amount), totalAmount: num(line.total_amount),
        })),
        netAmount: num(row.net_amount), vatAmount: num(row.vat_amount), totalAmount: num(row.total_amount),
        footer: permanentValue(snapshotReady, row.document_footer_snapshot, settings.document_footer) || null,
      };
    } else if (type === "credit_note") {
      const noteResult = await supabase.from("credit_notes").select("*,credit_note_lines(*)").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (noteResult.error) throw noteResult.error;
      const row = noteResult.data as Record<string, unknown> | null;
      if (!row) throw new CommandError("BUSINESS_DOCUMENT_NOT_FOUND", "Credit Note could not be found.", 404);
      const draft = String(row.status) === "draft";
      const snapshotReady = !draft && Boolean(row.document_permanence_snapshot_at);
      logoSnapshotPath = text(row.supplier_logo_path_snapshot) || null;
      const invoiceResult = await supabase.from("invoices").select("number,sales_order_reference").eq("workspace_id", workspaceId).eq("id", String(row.invoice_id)).maybeSingle();
      if (invoiceResult.error) throw invoiceResult.error;
      const customerResult = await supabase.from("customers").select("name,address,vat_number").eq("workspace_id", workspaceId).eq("id", String(row.customer_id)).maybeSingle();
      if (customerResult.error) throw customerResult.error;
      const lines = ((row.credit_note_lines ?? []) as Array<Record<string, unknown>>).sort((a, b) => Number(a.line_number) - Number(b.line_number));
      model = {
        kind: "credit_note", title: "Credit Note", number: String(row.number), draft,
        date: formatDocumentDate(String(row.issued_at ?? String(row.created_at).slice(0, 10))),
        originalInvoiceNumber: text(invoiceResult.data?.number),
        salesOrderReference: text(row.sales_order_reference ?? invoiceResult.data?.sales_order_reference) || null,
        reason: String(row.reason), currency: String(row.currency),
        supplier: {
          name: permanentValue(snapshotReady, row.supplier_name_snapshot, liveSupplierName) || "Supplier",
          address: permanentValue(snapshotReady, row.supplier_address_snapshot, settings.business_address) || null,
          vatNumber: permanentValue(snapshotReady, row.supplier_vat_number_snapshot, settings.vat_number) || null,
          registrationNumber: permanentValue(snapshotReady, row.supplier_registration_number_snapshot, settings.company_registration_number) || null,
        },
        customer: {
          name: permanentValue(snapshotReady, row.customer_name_snapshot, customerResult.data?.name) || "Customer",
          address: permanentValue(snapshotReady, row.customer_address_snapshot, customerResult.data?.address) || null,
          vatNumber: permanentValue(snapshotReady, row.customer_vat_number_snapshot, customerResult.data?.vat_number) || null,
        },
        lines: lines.map((line): BusinessDocumentLine => ({
          code: String(line.code_snapshot), description: String(line.description_snapshot), quantity: Number(line.quantity), unitPrice: num(line.unit_price),
          discountAmount: num(line.discount_amount), discountPercent: discountPercent(line), netAmount: num(line.net_amount), vatRate: num(line.vat_rate), vatAmount: num(line.vat_amount), totalAmount: num(line.total_amount),
        })),
        netAmount: num(row.net_amount), vatAmount: num(row.vat_amount), totalAmount: num(row.total_amount),
        footer: permanentValue(snapshotReady, row.document_footer_snapshot, settings.document_footer) || null,
      };
    } else {
      const noteResult = await supabase.from("delivery_notes").select("*,delivery_note_lines(*)").eq("workspace_id", workspaceId).eq("id", id).maybeSingle();
      if (noteResult.error) throw noteResult.error;
      const row = noteResult.data as Record<string, unknown> | null;
      if (!row) throw new CommandError("BUSINESS_DOCUMENT_NOT_FOUND", "Delivery Note could not be found.", 404);
      const draft = String(row.status) === "draft";
      const snapshotReady = !draft && Boolean(row.document_permanence_snapshot_at);
      logoSnapshotPath = text(row.supplier_logo_path_snapshot) || null;
      const customerResult = await supabase.from("customers").select("name,address,vat_number").eq("workspace_id", workspaceId).eq("id", String(row.customer_id)).maybeSingle();
      if (customerResult.error) throw customerResult.error;
      let originalInvoiceNumber: string | null = null;
      if (row.source_invoice_id) {
        const invoiceResult = await supabase.from("invoices").select("number").eq("workspace_id", workspaceId).eq("id", String(row.source_invoice_id)).maybeSingle();
        if (invoiceResult.error) throw invoiceResult.error;
        originalInvoiceNumber = text(invoiceResult.data?.number) || null;
      }
      const lines = ((row.delivery_note_lines ?? []) as Array<Record<string, unknown>>).sort((a, b) => Number(a.line_number) - Number(b.line_number));
      model = {
        kind: "delivery_note", title: "Delivery Note", number: String(row.number), draft, date: formatDocumentDate(String(row.delivery_date)), originalInvoiceNumber,
        supplier: {
          name: permanentValue(snapshotReady, row.supplier_name_snapshot, liveSupplierName) || "Supplier",
          address: permanentValue(snapshotReady, row.supplier_address_snapshot, settings.business_address) || null,
          vatNumber: permanentValue(snapshotReady, row.supplier_vat_number_snapshot, settings.vat_number) || null,
          registrationNumber: permanentValue(snapshotReady, row.supplier_registration_number_snapshot, settings.company_registration_number) || null,
        },
        customer: {
          name: permanentValue(snapshotReady, row.customer_name_snapshot, customerResult.data?.name) || "Customer",
          address: permanentValue(snapshotReady, row.customer_address_snapshot, customerResult.data?.address) || null,
          vatNumber: permanentValue(snapshotReady, row.customer_vat_number_snapshot, customerResult.data?.vat_number) || null,
        },
        deliveryAddress: text(row.delivery_address) || null,
        lines: lines.map((line): BusinessDocumentLine => ({ code: String(line.code_snapshot), description: String(line.description_snapshot), quantity: Number(line.quantity) })),
        footer: permanentValue(snapshotReady, row.document_footer_snapshot, settings.document_footer) || null,
      };
    }

    const admin = createAdminClient();
    let logoPath = model.draft ? null : logoSnapshotPath;

    // Draft previews may use today's workspace branding. Issued documents only use
    // the logo snapshot captured at issue time; there is no live-branding fallback.
    if (model.draft) {
      const customBrandingEnabled = ((featureResult.data ?? []) as Array<{ feature_key: string; enabled: boolean }>).some((feature) => feature.feature_key === "custom_branding" && feature.enabled);
      if (customBrandingEnabled && admin) {
        const theme = await admin.from("workspace_themes").select("client_logo_path").eq("workspace_id", workspaceId).maybeSingle();
        if (!theme.error) logoPath = theme.data?.client_logo_path ? String(theme.data.client_logo_path) : null;
      }
    }

    if (logoPath && admin) {
      const signed = await admin.storage.from("workspace-assets").createSignedUrl(logoPath, 1800);
      if (!signed.error) model.logoUrl = signed.data?.signedUrl ?? null;
    }

    return model;
  });

  const payload = await result.json().catch(() => null) as { ok?: boolean; result?: BusinessDocumentModel; error?: string } | null;
  if (!result.ok || !payload?.ok || !payload.result) return result;
  const document = payload.result;
  const safeName = `${document.title.replaceAll(" ", "-").toLowerCase()}-${document.draft ? "draft" : document.number}.pdf`.replace(/[^a-zA-Z0-9._-]/g, "-");
  if (format === "pdf") return new Response(businessDocumentPdf(document), { status: 200, headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${safeName}"`, "Cache-Control": "no-store" } });
  return new Response(businessDocumentHtml(document, url.searchParams.get("print") === "1"), { status: 200, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
