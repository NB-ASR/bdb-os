export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_DATA_LENGTH = 4.1 * 1024 * 1024;

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
          quantity: { type: "number" },
          unit_cost: { type: ["number", "null"] },
          rrp: { type: ["number", "null"] },
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

type ResponsesPayload = {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  error?: { message?: string };
};

type ExtractionRequest = {
  fileName?: string;
  mimeType?: string;
  fileData?: string;
};

function json(status: number, body: Record<string, unknown>) {
  return Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Robots-Tag": "noindex, nofollow",
    },
  });
}

async function verifyStaff(request: Request, supabaseUrl: string, supabaseAnonKey: string) {
  const authorization = request.headers.get("authorization") || "";
  if (!authorization.startsWith("Bearer ")) return false;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      Authorization: authorization,
      apikey: supabaseAnonKey,
    },
    cache: "no-store",
  });

  return response.ok;
}

function outputText(response: ResponsesPayload) {
  return response.output
    ?.flatMap((item) => item.content || [])
    .find((item) => item.type === "output_text")
    ?.text || "";
}

export async function POST(request: Request) {
  const openAiKey = process.env.OPENAI_API_KEY || "";
  const supabaseUrl = process.env.VANITA_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.VANITA_SUPABASE_ANON_KEY || "";

  if (!openAiKey) return json(503, { error: "Automatic extraction is not configured in this review environment." });
  if (!supabaseUrl || !supabaseAnonKey) {
    return json(503, { error: "Vanita staff authentication is not configured in this review environment." });
  }

  try {
    if (!(await verifyStaff(request, supabaseUrl, supabaseAnonKey))) {
      return json(401, { error: "Please sign in again before extracting a document." });
    }

    const payload = (await request.json()) as ExtractionRequest;
    const { fileName, mimeType, fileData } = payload;

    if (!fileName || !fileData || typeof fileData !== "string") {
      return json(400, { error: "No document was supplied." });
    }
    if (!/^data:(application\/pdf|image\/(jpeg|png|webp));base64,/.test(fileData)) {
      return json(400, { error: "Only PDF, JPG, PNG and WebP documents are supported." });
    }
    if (fileData.length > MAX_DATA_LENGTH) {
      return json(413, { error: "The document is too large for automatic extraction." });
    }

    const fileContent = mimeType === "application/pdf"
      ? { type: "input_file", filename: fileName, file_data: fileData }
      : { type: "input_image", image_url: fileData, detail: "high" };

    const openAiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_DOCUMENT_MODEL || "gpt-5.4",
        reasoning: { effort: "medium" },
        input: [{
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Extract this supplier invoice or credit note exactly as printed.

Read the complete product table row by row from the first product beneath the column headings through the last product immediately before the totals. Return exactly one item for every printed product row. Never merge similar descriptions, omit zero-priced rows, or stop early.

Follow each row horizontally and keep values in their printed columns:
- sku: Code, Stock Code, Item Code, Product Code or SKU.
- name: Description or Product.
- quantity: Qty or Quantity only. Do not use handwritten marks or the Free column as quantity.
- unit_cost: Price, Unit Price, Unit Cost or Rate only. Do not use Net, line total, RRP or VAT.
- rrp: RRP, Retail or Recommended Retail Price for that same row.
- barcode: the full barcode digits for that same row. Preserve leading zeroes and return it as a string.

Where a table has columns such as Qty, Free, Price, Net, VAT, RRP and Barcode, treat each as a separate column. Printed figures take precedence over handwriting.

Also read the printed invoice-level totals separately from the product rows:
- subtotal_before_discount: the merchandise subtotal before any supplier discount.
- discount_amount: the supplier discount as a positive monetary amount, not a percentage.
- net_after_discount: the taxable net after discount and before VAT.
- vat_rate: the printed VAT percentage when visible.
- vat_amount: the printed VAT amount after discount.
- gross_amount: the final amount payable including VAT after discount.

Do not force the printed invoice totals to equal the sum of extracted rows. Keep row-level unit costs exactly as printed because they represent catalogue stock cost before supplier-level discount. If a printed total is absent, return null rather than estimating it.

Never invent missing values. Use empty strings or null. Quantities and monetary values must be numbers. Return dates as YYYY-MM-DD when visible, otherwise an empty string. Classify the document as Invoice, Credit Note, or Other. Confidence must reflect the reliability of the entire extraction. The result will be reviewed by a human before inventory changes.`,
            },
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

    const result = await openAiResponse.json() as ResponsesPayload;
    if (!openAiResponse.ok) {
      throw new Error(result.error?.message || "The extraction service returned an error.");
    }

    const text = outputText(result);
    if (!text) throw new Error("No document details were returned.");

    return json(200, { document: JSON.parse(text) as unknown });
  } catch (error) {
    console.error("Vanita document extraction failed", error);
    return json(500, { error: "We could not read this document. Try a clearer image or PDF." });
  }
}
