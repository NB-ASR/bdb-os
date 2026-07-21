const MAX_DATA_LENGTH = 4.1 * 1024 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 12;
const TEST_VERSION_TOKEN = "test-version";

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
          rrp: { type: ["number", "null"] }
        },
        required: ["name", "sku", "barcode", "quantity", "unit_cost", "rrp"]
      }
    }
  },
  required: ["document_type", "supplier", "document_number", "document_date", "confidence", "notes", "subtotal_before_discount", "discount_amount", "net_after_discount", "vat_rate", "vat_amount", "gross_amount", "items"]
};

function send(response, status, body) {
  response.status(status).setHeader("Cache-Control", "no-store").json(body);
}

function isAllowedOrigin(request) {
  const origin = String(request.headers.origin || "").trim();
  if (!origin) return true;
  if (/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  if (origin === "https://vanita-stock.vercel.app") return true;
  return /^https:\/\/vanita-stock-[a-z0-9-]+\.vercel\.app$/i.test(origin);
}

function isTestVersionRequest(request) {
  return String(request.headers.authorization || "") === `Bearer ${TEST_VERSION_TOKEN}`;
}

function clientIdentifier(request) {
  const forwarded = String(request.headers["x-forwarded-for"] || "").split(",")[0].trim();
  return forwarded || String(request.socket?.remoteAddress || "unknown");
}

function rateLimitExceeded(request) {
  const now = Date.now();
  const key = clientIdentifier(request);
  const buckets = globalThis.__vanitaExtractionRateLimits || (globalThis.__vanitaExtractionRateLimits = new Map());
  const existing = buckets.get(key);
  const bucket = !existing || now - existing.startedAt >= RATE_LIMIT_WINDOW_MS
    ? { startedAt:now, requests:0 }
    : existing;
  bucket.requests += 1;
  buckets.set(key, bucket);

  if (buckets.size > 1000) {
    for (const [entryKey, entry] of buckets) {
      if (now - entry.startedAt >= RATE_LIMIT_WINDOW_MS) buckets.delete(entryKey);
    }
  }

  return bucket.requests > RATE_LIMIT_MAX_REQUESTS;
}

function outputText(response) {
  return response.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text || "";
}

export default async function handler(request, response) {
  if (request.method !== "POST") return send(response, 405, { error:"Method not allowed." });
  if (!process.env.OPENAI_API_KEY) return send(response, 503, { error:"Automatic extraction is not configured yet." });
  if (!isAllowedOrigin(request) || !isTestVersionRequest(request)) return send(response, 403, { error:"This extraction request is not permitted." });
  if (rateLimitExceeded(request)) return send(response, 429, { error:"The test-version extraction limit has been reached. Try again later." });

  try {
    const { fileName, mimeType, fileData } = request.body || {};
    if (!fileName || !fileData || typeof fileData !== "string") return send(response, 400, { error:"No document was supplied." });
    if (!/^data:(application\/pdf|image\/(jpeg|png|webp));base64,/.test(fileData)) return send(response, 400, { error:"Only PDF, JPG, PNG and WebP documents are supported." });
    if (fileData.length > MAX_DATA_LENGTH) return send(response, 413, { error:"The document is too large for automatic extraction." });

    const fileContent = mimeType === "application/pdf"
      ? { type:"input_file", filename:fileName, file_data:fileData }
      : { type:"input_image", image_url:fileData, detail:"high" };

    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Authorization":`Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type":"application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_DOCUMENT_MODEL || "gpt-5.4",
        reasoning: { effort:"medium" },
        input: [{
          role: "user",
          content: [
            { type:"input_text", text:`Extract this supplier invoice or credit note exactly as printed.

Read the complete product table row by row from the first product beneath the column headings through the last product immediately before the totals. Return exactly one item for every printed product row—never merge similar descriptions, omit zero-priced rows, or stop early.

Follow each row horizontally and keep values in their printed columns:
- sku: Code, Stock Code, Item Code, Product Code or SKU.
- name: Description or Product.
- quantity: Qty or Quantity only. Do not use handwritten marks or the Free column as quantity.
- unit_cost: Price, Unit Price, Unit Cost or Rate only. Do not use Net, line total, RRP or VAT.
- rrp: RRP, Retail or Recommended Retail Price for that same row.
- barcode: the full barcode digits for that same row. Preserve leading zeroes and return it as a string.

Where a table has columns such as "Qty | Free | Price | Net | VAT | RRP | Barcode", treat each as a separate column. Printed figures take precedence over handwriting.

Also read the printed invoice-level totals separately from the product rows:
- subtotal_before_discount: the merchandise subtotal before any supplier discount. On documents labelled Net, Discount, Subtotal, VAT and Gross, use the first Net figure before Discount.
- discount_amount: the supplier discount as a positive monetary amount. Do not return a percentage here.
- net_after_discount: the taxable net/subtotal after discount and before VAT.
- vat_rate: the printed VAT percentage when visible.
- vat_amount: the printed VAT amount after discount.
- gross_amount: the final amount payable including VAT after discount.

Do not force the printed invoice totals to equal the sum of extracted rows. Keep the row-level unit costs exactly as printed because they represent the catalogue stock cost before supplier-level discount. The application stores both this undiscounted stock value and the discounted amount actually paid for reporting. If a printed total is absent, return null rather than estimating it.

Never invent missing values: use empty strings or null. Quantities and monetary values must be numbers. Return dates as YYYY-MM-DD when visible, otherwise an empty string. Classify the document as Invoice, Credit Note, or Other. Confidence must reflect the reliability of the entire extraction. The result will be reviewed by a human before inventory changes.` },
            fileContent
          ]
        }],
        text: { format: { type:"json_schema", name:"supplier_document", strict:true, schema:documentSchema } }
      })
    });

    const result = await openaiResponse.json();
    if (!openaiResponse.ok) throw new Error(result.error?.message || "The extraction service returned an error.");
    const text = outputText(result);
    if (!text) throw new Error("No document details were returned.");
    return send(response, 200, { document:JSON.parse(text) });
  } catch (error) {
    console.error("Document extraction failed", error);
    return send(response, 500, { error:"We could not read this document. Try a clearer image or PDF." });
  }
}