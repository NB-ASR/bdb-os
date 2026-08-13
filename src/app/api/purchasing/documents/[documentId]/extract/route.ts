import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CommandError, parseCommandBody, requireWorkspaceCommand, runCommand } from "@/lib/server/command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCHEMA_VERSION = "supplier-document-v1";

const documentSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    document_type: { type: "string", enum: ["Invoice", "Credit Note", "Other"] },
    supplier: { type: "string" },
    document_number: { type: "string" },
    document_date: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    notes: { type: "array", items: { type: "string" } },
    subtotal_before_discount: { type: ["number", "null"] },
    discount_amount: { type: ["number", "null"] },
    net_after_discount: { type: ["number", "null"] },
    vat_rate: { type: ["number", "null"] },
    vat_amount: { type: ["number", "null"] },
    gross_amount: { type: ["number", "null"] },
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string" },
          sku: { type: "string" },
          barcode: { type: "string" },
          quantity: { type: "number", exclusiveMinimum: 0 },
          unit_cost: { type: ["number", "null"], minimum: 0 },
          rrp: { type: ["number", "null"], minimum: 0 },
        },
        required: ["name", "sku", "barcode", "quantity", "unit_cost", "rrp"],
      },
    },
  },
  required: [
    "document_type",
    "supplier",
    "document_number",
    "document_date",
    "confidence",
    "notes",
    "subtotal_before_discount",
    "discount_amount",
    "net_after_discount",
    "vat_rate",
    "vat_amount",
    "gross_amount",
    "items",
  ],
};

type ExtractBody = Record<string, unknown> & { workspaceId?: unknown };
type ResponsesPayload = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  output_text?: string;
  error?: { message?: string };
};

function uuid(value: unknown, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_PURCHASING_INPUT", `${field} is invalid.`);
  return result;
}

function outputText(response: ResponsesPayload) {
  return response.output_text
    || response.output?.flatMap((item) => item.content || []).find((item) => item.type === "output_text")?.text
    || "";
}

function extractionPrompt() {
  return `Extract this supplier invoice or credit note exactly as printed.

Read the complete item table row by row from the first item beneath the column headings through the final item before the totals. Return exactly one item for every printed row. Never merge similar descriptions, omit zero-priced rows, or stop early.

Follow each row horizontally and keep values in their printed columns:
- sku: Code, Stock Code, Item Code, Product Code or Supplier SKU.
- name: Description, Item or Product.
- quantity: Qty or Quantity only. Do not use handwritten marks or a Free column as quantity.
- unit_cost: Price, Unit Price, Unit Cost or Rate only. Do not use Net, line total, RRP or VAT.
- rrp: RRP, Retail or Recommended Retail Price for the same row.
- barcode: the complete barcode digits for that row. Preserve leading zeroes and return it as a string.

Where a table contains Qty, Free, Price, Net, VAT, RRP and Barcode, treat each as a separate column. Printed figures take precedence over handwriting.

Read invoice-level totals separately:
- subtotal_before_discount: merchandise subtotal before supplier discount.
- discount_amount: supplier discount as a positive monetary amount, not a percentage.
- net_after_discount: taxable net after discount and before VAT.
- vat_rate: printed VAT percentage when visible.
- vat_amount: printed VAT amount after discount.
- gross_amount: final amount payable including VAT after discount.

Do not force printed totals to equal the sum of extracted rows. Keep row-level unit costs exactly as printed. When a value is absent, return null or an empty string rather than estimating it.

Return dates as YYYY-MM-DD when visible, otherwise an empty string. Classify the document as Invoice, Credit Note or Other. Confidence must represent the reliability of the complete extraction. A human reviewer will approve the result before Inventory or Accounts can receive any posting command.`;
}

export async function POST(
  request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  return runCommand(async () => {
    const { documentId: rawDocumentId } = await context.params;
    const documentId = uuid(rawDocumentId, "Document ID");
    const body = await parseCommandBody<ExtractBody>(request);
    const workspaceId = uuid(body.workspaceId, "Workspace");
    const commandContext = await requireWorkspaceCommand(request, workspaceId);
    const openAiKey = process.env.OPENAI_API_KEY?.trim();
    const model = process.env.OPENAI_DOCUMENT_MODEL?.trim() || "gpt-5";
    if (!openAiKey) {
      throw new CommandError("DOCUMENT_EXTRACTION_NOT_CONFIGURED", "Automatic document extraction is not configured in this environment.", 503);
    }

    const supabase = await createClient();
    const admin = createAdminClient();
    if (!supabase || !admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);

    const documentResult = await supabase
      .from("supplier_documents")
      .select("id,file_bucket,file_path,file_name,mime_type,status")
      .eq("workspace_id", workspaceId)
      .eq("id", documentId)
      .maybeSingle();
    if (documentResult.error) throw documentResult.error;
    if (!documentResult.data) throw new CommandError("SUPPLIER_DOCUMENT_NOT_FOUND", "The supplier document could not be found.", 404);
    if (["approved", "archived"].includes(documentResult.data.status)) {
      throw new CommandError("SUPPLIER_DOCUMENT_LOCKED", "Approved or archived documents cannot be scanned again.", 409);
    }

    const runId = randomUUID();
    const beginResult = await admin.rpc("begin_supplier_document_extraction", {
      p_workspace_id: workspaceId,
      p_document_id: documentId,
      p_run_id: runId,
      p_actor_user_id: commandContext.userId,
      p_model: model,
    });
    if (beginResult.error) {
      const forbidden = beginResult.error.message.toLowerCase().includes("write access denied");
      throw new CommandError(
        forbidden ? "SUPPLIER_DOCUMENT_FORBIDDEN" : "DOCUMENT_EXTRACTION_START_FAILED",
        forbidden ? "You do not have permission to scan this Purchasing document." : beginResult.error.message,
        forbidden ? 403 : 400,
      );
    }

    try {
      const downloadResult = await admin.storage
        .from(documentResult.data.file_bucket)
        .download(documentResult.data.file_path);
      if (downloadResult.error) throw downloadResult.error;
      const bytes = Buffer.from(await downloadResult.data.arrayBuffer());
      const fileData = `data:${documentResult.data.mime_type};base64,${bytes.toString("base64")}`;
      const fileContent = documentResult.data.mime_type === "application/pdf"
        ? { type: "input_file", filename: documentResult.data.file_name, file_data: fileData }
        : { type: "input_image", image_url: fileData, detail: "high" };

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          store: false,
          reasoning: { effort: "medium" },
          input: [{
            role: "user",
            content: [
              { type: "input_text", text: extractionPrompt() },
              fileContent,
            ],
          }],
          text: {
            format: {
              type: "json_schema",
              name: "supplier_document",
              strict: true,
              schema: documentSchema,
            },
          },
        }),
      });
      const payload = await response.json() as ResponsesPayload;
      if (!response.ok) throw new Error(payload.error?.message || "The extraction service returned an error.");
      const text = outputText(payload);
      if (!text) throw new Error("No structured supplier-document data was returned.");
      const extracted = JSON.parse(text) as Record<string, unknown>;

      const completeResult = await admin.rpc("complete_supplier_document_extraction", {
        p_workspace_id: workspaceId,
        p_document_id: documentId,
        p_run_id: runId,
        p_actor_user_id: commandContext.userId,
        p_provider: "openai",
        p_model: model,
        p_schema_version: SCHEMA_VERSION,
        p_output: extracted,
      });
      if (completeResult.error) throw completeResult.error;
      return completeResult.data as Record<string, unknown>;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Document extraction failed.";
      const failureResult = await admin.rpc("fail_supplier_document_extraction", {
        p_workspace_id: workspaceId,
        p_document_id: documentId,
        p_run_id: runId,
        p_actor_user_id: commandContext.userId,
        p_error_message: message,
      });
      if (failureResult.error) console.error("Could not record supplier-document extraction failure", failureResult.error);
      console.error("Supplier document extraction failed", error);
      throw new CommandError("DOCUMENT_EXTRACTION_FAILED", "We could not read this document. Try a clearer image or PDF.", 422);
    }
  });
}
