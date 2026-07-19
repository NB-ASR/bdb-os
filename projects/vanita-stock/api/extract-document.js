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
  required: ["document_type", "supplier", "document_number", "document_date", "confidence", "notes", "items"]
};

function send(response, status, body) {
  response.status(status).setHeader("Cache-Control", "no-store").json(body);
}

async function verifyStaff(request) {
  const authorization = request.headers.authorization || "";
  if (!authorization.startsWith("Bearer ")) return false;
  const result = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: { Authorization:authorization, apikey:process.env.SUPABASE_ANON_KEY }
  });
  return result.ok;
}

function outputText(response) {
  return response.output?.flatMap(item => item.content || []).find(item => item.type === "output_text")?.text || "";
}

export default async function handler(request, response) {
  if (request.method !== "POST") return send(response, 405, { error:"Method not allowed." });
  if (!process.env.OPENAI_API_KEY) return send(response, 503, { error:"Automatic extraction is not configured yet." });
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) return send(response, 503, { error:"Staff authentication is not configured." });

  try {
    if (!(await verifyStaff(request))) return send(response, 401, { error:"Please sign in again before extracting a document." });
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

Where a table has columns such as "Qty | Free | Price | Net | VAT | RRP | Barcode", treat each as a separate column. Printed figures take precedence over handwriting. Ignore the Net, VAT, subtotal and gross-total figures for calculation purposes: the application calculates all totals only from the extracted product rows. Do not use or return any invoice-level monetary totals.

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
