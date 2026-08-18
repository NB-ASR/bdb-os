export type BusinessDocumentType = "invoice" | "credit_note" | "delivery_note";

export type BusinessDocumentLine = {
  code: string;
  description: string;
  quantity: number;
  unitPrice?: number | null;
  discount?: number | null;
  vatRate?: number | null;
  vatAmount?: number | null;
  total?: number | null;
};

export type BusinessDocumentModel = {
  type: BusinessDocumentType;
  title: string;
  number: string;
  status: string;
  issueDate: string | null;
  supplyDate?: string | null;
  dueDate?: string | null;
  sourceReference?: string | null;
  supplier: {
    name: string;
    address: string | null;
    vatNumber: string | null;
    email?: string | null;
    phone?: string | null;
  };
  customer: {
    name: string;
    address: string | null;
    vatNumber: string | null;
    email?: string | null;
  };
  lines: BusinessDocumentLine[];
  currency?: string | null;
  grossAmount?: number | null;
  discountAmount?: number | null;
  netAmount?: number | null;
  vatAmount?: number | null;
  totalAmount?: number | null;
  outstandingAmount?: number | null;
  reason?: string | null;
  notes?: string | null;
  vatNote?: string | null;
  deliveryAddress?: string | null;
  logoUrl?: string | null;
};

function htmlEscape(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function money(value: number | null | undefined, currency = "EUR") {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("en-MT", { style: "currency", currency, minimumFractionDigits: 2 }).format(Number(value));
}

function date(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(parsed);
}

export function businessDocumentFilename(model: BusinessDocumentModel) {
  const safe = model.number.replace(/[^A-Za-z0-9._-]/g, "-");
  return `${model.type.replaceAll("_", "-")}-${safe || "draft"}`;
}

export function renderBusinessDocumentHtml(model: BusinessDocumentModel, autoPrint = false) {
  const currency = model.currency ?? "EUR";
  const financial = model.type !== "delivery_note";
  const rows = model.lines.map((line) => `
    <tr>
      <td>${htmlEscape(line.code)}</td>
      <td>${htmlEscape(line.description)}</td>
      <td class="num">${htmlEscape(line.quantity)}</td>
      ${financial ? `<td class="num">${money(line.unitPrice, currency)}</td><td class="num">${htmlEscape(line.vatRate ?? 0)}%</td><td class="num">${money(line.total, currency)}</td>` : ""}
    </tr>`).join("");
  const totals = financial ? `
    <div class="totals">
      <div><span>Gross</span><strong>${money(model.grossAmount, currency)}</strong></div>
      <div><span>Discount</span><strong>${money(model.discountAmount, currency)}</strong></div>
      <div><span>Net</span><strong>${money(model.netAmount, currency)}</strong></div>
      <div><span>VAT</span><strong>${money(model.vatAmount, currency)}</strong></div>
      <div class="grand"><span>${model.type === "credit_note" ? "Credit total" : "Total"}</span><strong>${money(model.totalAmount, currency)}</strong></div>
      ${model.type === "invoice" && model.outstandingAmount !== null && model.outstandingAmount !== undefined ? `<div><span>Balance due</span><strong>${money(model.outstandingAmount, currency)}</strong></div>` : ""}
    </div>` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${htmlEscape(model.title)} ${htmlEscape(model.number)}</title>
<style>
@page{size:A4;margin:18mm}*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1b1b1b;margin:0;background:#eceae5}main{width:210mm;min-height:297mm;margin:18px auto;background:#fff;padding:18mm;box-shadow:0 8px 28px rgba(0,0,0,.12)}header{display:flex;justify-content:space-between;gap:28px;border-bottom:2px solid #b08a3e;padding-bottom:20px}.brand{max-width:55%}.brand img{max-width:170px;max-height:72px;object-fit:contain;margin-bottom:12px}.brand h1{margin:0;font-size:24px}.brand p,.party p,.meta p{margin:4px 0;color:#555;font-size:12px;line-height:1.45}.doc-title{text-align:right}.doc-title h2{margin:0;font-size:30px;letter-spacing:.04em}.doc-title strong{display:block;margin-top:8px;font-size:16px;color:#8a6a2e}.grid{display:grid;grid-template-columns:1fr 1fr;gap:30px;margin:26px 0}.party h3,.meta h3{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#8a6a2e;margin:0 0 8px}.meta{text-align:right}table{width:100%;border-collapse:collapse;margin-top:20px;font-size:12px}th{text-align:left;border-bottom:1px solid #777;padding:8px 6px;color:#555}td{padding:9px 6px;border-bottom:1px solid #ddd;vertical-align:top}.num{text-align:right}.totals{margin:24px 0 0 auto;width:310px}.totals div{display:flex;justify-content:space-between;padding:5px 0;font-size:12px}.totals .grand{border-top:1px solid #555;margin-top:5px;padding-top:10px;font-size:15px}.note{margin-top:24px;border-top:1px solid #ddd;padding-top:14px;font-size:12px;line-height:1.5}.status{display:inline-block;padding:5px 9px;border:1px solid #b08a3e;border-radius:999px;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.footer{margin-top:42px;color:#777;font-size:10px;text-align:center}@media print{body{background:#fff}main{margin:0;width:auto;min-height:auto;box-shadow:none;padding:0}.no-print{display:none!important}}
</style></head><body>
<main>
<header><div class="brand">${model.logoUrl ? `<img src="${htmlEscape(model.logoUrl)}" alt="Business logo">` : ""}<h1>${htmlEscape(model.supplier.name)}</h1><p>${htmlEscape(model.supplier.address)}</p><p>${model.supplier.vatNumber ? `VAT: ${htmlEscape(model.supplier.vatNumber)}` : ""}</p><p>${htmlEscape(model.supplier.email)}${model.supplier.email && model.supplier.phone ? " · " : ""}${htmlEscape(model.supplier.phone)}</p></div><div class="doc-title"><h2>${htmlEscape(model.title)}</h2><strong>${htmlEscape(model.number)}</strong><p class="status">${htmlEscape(model.status)}</p></div></header>
<div class="grid"><section class="party"><h3>Customer</h3><p><strong>${htmlEscape(model.customer.name)}</strong></p><p>${htmlEscape(model.customer.address)}</p>${model.customer.vatNumber ? `<p>VAT: ${htmlEscape(model.customer.vatNumber)}</p>` : ""}${model.customer.email ? `<p>${htmlEscape(model.customer.email)}</p>` : ""}${model.deliveryAddress ? `<h3 style="margin-top:14px">Delivery address</h3><p>${htmlEscape(model.deliveryAddress)}</p>` : ""}</section><section class="meta"><h3>Document details</h3><p>Issue date: ${date(model.issueDate)}</p>${model.supplyDate ? `<p>Supply date: ${date(model.supplyDate)}</p>` : ""}${model.dueDate ? `<p>Due date: ${date(model.dueDate)}</p>` : ""}${model.sourceReference ? `<p>Reference: ${htmlEscape(model.sourceReference)}</p>` : ""}</section></div>
<table><thead><tr><th>Code</th><th>Description</th><th class="num">Qty</th>${financial ? '<th class="num">Unit price</th><th class="num">VAT</th><th class="num">Total</th>' : ""}</tr></thead><tbody>${rows}</tbody></table>
${totals}
${model.reason ? `<div class="note"><strong>Reason</strong><br>${htmlEscape(model.reason)}</div>` : ""}
${model.vatNote ? `<div class="note"><strong>VAT / legal treatment</strong><br>${htmlEscape(model.vatNote)}</div>` : ""}
${model.notes ? `<div class="note"><strong>Notes</strong><br>${htmlEscape(model.notes)}</div>` : ""}
<div class="footer">Generated from the authoritative BDB OS business record.</div>
</main>${autoPrint ? "<script>window.addEventListener('load',()=>window.print())</script>" : ""}</body></html>`;
}

function pdfEscape(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll(/[^\x20-\x7E]/g, "?");
}

function wrap(value: string, width = 82) {
  const words = value.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) { lines.push(current); current = word; }
    else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

export function renderBusinessDocumentPdf(model: BusinessDocumentModel) {
  const currency = model.currency ?? "EUR";
  const text: Array<{ value: string; bold?: boolean; size?: number; gap?: number }> = [];
  text.push({ value: model.supplier.name, bold: true, size: 16, gap: 4 });
  if (model.supplier.address) wrap(model.supplier.address).forEach((value) => text.push({ value, size: 9 }));
  if (model.supplier.vatNumber) text.push({ value: `VAT: ${model.supplier.vatNumber}`, size: 9, gap: 8 });
  text.push({ value: `${model.title.toUpperCase()}  ${model.number}`, bold: true, size: 15, gap: 5 });
  text.push({ value: `Status: ${model.status}   Issue date: ${date(model.issueDate)}`, size: 9 });
  if (model.supplyDate) text.push({ value: `Supply date: ${date(model.supplyDate)}`, size: 9 });
  if (model.dueDate) text.push({ value: `Due date: ${date(model.dueDate)}`, size: 9 });
  if (model.sourceReference) text.push({ value: `Reference: ${model.sourceReference}`, size: 9, gap: 8 });
  text.push({ value: `Customer: ${model.customer.name}`, bold: true, size: 10 });
  if (model.customer.address) wrap(model.customer.address).forEach((value) => text.push({ value, size: 9 }));
  if (model.customer.vatNumber) text.push({ value: `Customer VAT: ${model.customer.vatNumber}`, size: 9 });
  if (model.deliveryAddress) wrap(`Delivery address: ${model.deliveryAddress}`).forEach((value) => text.push({ value, size: 9 }));
  text.push({ value: "", gap: 6 });
  for (const line of model.lines) {
    const tail = model.type === "delivery_note" ? `Qty ${line.quantity}` : `Qty ${line.quantity}  ${money(line.total, currency)}  VAT ${line.vatRate ?? 0}%`;
    wrap(`${line.code}  ${line.description}  ${tail}`, 95).forEach((value, index) => text.push({ value, size: index === 0 ? 9 : 8 }));
  }
  if (model.type !== "delivery_note") {
    text.push({ value: "", gap: 8 });
    text.push({ value: `Net: ${money(model.netAmount, currency)}   VAT: ${money(model.vatAmount, currency)}   Total: ${money(model.totalAmount, currency)}`, bold: true, size: 10 });
    if (model.type === "invoice" && model.outstandingAmount !== null && model.outstandingAmount !== undefined) text.push({ value: `Balance due: ${money(model.outstandingAmount, currency)}`, bold: true, size: 10 });
  }
  if (model.reason) wrap(`Reason: ${model.reason}`).forEach((value) => text.push({ value, size: 9 }));
  if (model.vatNote) wrap(`VAT / legal treatment: ${model.vatNote}`).forEach((value) => text.push({ value, size: 9 }));
  if (model.notes) wrap(`Notes: ${model.notes}`).forEach((value) => text.push({ value, size: 9 }));

  const pages: string[][] = [[]];
  let y = 800;
  for (const row of text) {
    const gap = row.gap ?? 2;
    const height = (row.size ?? 9) + gap;
    if (y - height < 45) { pages.push([]); y = 800; }
    const font = row.bold ? "F2" : "F1";
    pages.at(-1)!.push(`BT /${font} ${row.size ?? 9} Tf 45 ${y} Td (${pdfEscape(row.value)}) Tj ET`);
    y -= height;
  }

  const objects: string[] = [];
  const add = (value: string) => { objects.push(value); return objects.length; };
  const catalog = add("<< /Type /Catalog /Pages 2 0 R >>");
  void catalog;
  objects.push("");
  const fontRegular = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const fontBold = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>");
  const pageIds: number[] = [];
  const contentIds: number[] = [];
  for (const commands of pages) {
    const stream = commands.join("\n");
    const contentId = add(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
    contentIds.push(contentId);
    const pageId = add("");
    pageIds.push(pageId);
  }
  objects[1] = `<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] >>`;
  pageIds.forEach((pageId, index) => {
    objects[pageId - 1] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentIds[index]} 0 R >>`;
  });

  let output = "%PDF-1.4\n% BDB OS\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(output, "latin1"));
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(output, "latin1");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= objects.length; i += 1) output += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(output, "latin1");
}
