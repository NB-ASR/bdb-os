export type BusinessDocumentKind = "invoice" | "credit_note" | "delivery_note";

export type BusinessDocumentLine = {
  code: string;
  description: string;
  quantity: number;
  unitPrice?: number | null;
  discountAmount?: number | null;
  discountPercent?: number | null;
  netAmount?: number | null;
  vatRate?: number | null;
  vatAmount?: number | null;
  totalAmount?: number | null;
};

export type BusinessDocumentModel = {
  kind: BusinessDocumentKind;
  title: string;
  number: string;
  draft: boolean;
  date: string;
  description?: string | null;
  supplyDate?: string | null;
  originalInvoiceNumber?: string | null;
  salesOrderReference?: string | null;
  reason?: string | null;
  currency?: string | null;
  supplier: {
    name: string;
    address?: string | null;
    vatNumber?: string | null;
    registrationNumber?: string | null;
    email?: string | null;
    phone?: string | null;
  };
  customer: {
    name: string;
    address?: string | null;
    vatNumber?: string | null;
  };
  deliveryAddress?: string | null;
  lines: BusinessDocumentLine[];
  netAmount?: number | null;
  vatAmount?: number | null;
  totalAmount?: number | null;
  footer?: string | null;
  logoUrl?: string | null;
};

function escapeHtml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function money(value: number | null | undefined, currency?: string | null) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return "—";
  return `${currency ?? ""} ${Number(value).toFixed(2)}`.trim();
}
function quantity(value: number) {
  return Number.isInteger(value) ? String(value) : Number(value).toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}
function discount(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(Number(value)) || Number(value) <= 0) return "—";
  return `${Number(value).toFixed(2)}%`;
}
function supplierContact(document: BusinessDocumentModel) {
  return [document.supplier.phone ? `Tel: ${document.supplier.phone}` : "", document.supplier.email ? `Email: ${document.supplier.email}` : ""].filter(Boolean).join("<br>");
}

export function businessDocumentHtml(document: BusinessDocumentModel, printOnLoad = false) {
  const priced = document.kind !== "delivery_note";
  const rows = document.lines.map((line) => `
    <tr>
      <td class="code">${escapeHtml(line.code)}</td>
      <td class="description">${escapeHtml(line.description)}</td>
      <td class="numeric">${quantity(line.quantity)}</td>
      ${priced ? `<td class="numeric">${money(line.unitPrice, document.currency)}</td><td class="numeric">${discount(line.discountPercent)}</td><td class="numeric">${line.vatRate == null ? "—" : `${Number(line.vatRate).toFixed(2)}%`}</td><td class="numeric amount">${money(line.totalAmount, document.currency)}</td>` : ""}
    </tr>`).join("");

  const totals = priced ? `
    <section class="totals">
      <div><span>${document.kind === "credit_note" ? "Credit subtotal" : "Subtotal after discount"}</span><strong>${money(document.netAmount, document.currency)}</strong></div>
      <div><span>VAT</span><strong>${money(document.vatAmount, document.currency)}</strong></div>
      <div class="grand"><span>${document.kind === "credit_note" ? "Credit total" : "Total"}</span><strong>${money(document.totalAmount, document.currency)}</strong></div>
    </section>` : "";

  const legalWarning = document.draft ? `<div class="draft">DRAFT · Not an issued business document</div>` : "";
  const customerBlock = `<section class="bill-block"><div><p class="block-label">Bill To</p><strong>${escapeHtml(document.customer.name)}</strong><p>${escapeHtml(document.customer.address ?? "")}</p>${document.customer.vatNumber ? `<p>VAT: ${escapeHtml(document.customer.vatNumber)}</p>` : ""}</div><div class="facts"><div><span>${escapeHtml(document.title)} No.</span><strong>${escapeHtml(document.draft ? "Draft" : document.number)}</strong></div><div><span>${document.kind === "delivery_note" ? "Delivery date" : `${escapeHtml(document.title)} date`}</span><strong>${escapeHtml(document.date)}</strong></div>${document.originalInvoiceNumber ? `<div><span>Original Invoice</span><strong>${escapeHtml(document.originalInvoiceNumber)}</strong></div>` : ""}${document.salesOrderReference ? `<div><span>SO number</span><strong>${escapeHtml(document.salesOrderReference)}</strong></div>` : ""}${document.kind === "delivery_note" && document.deliveryAddress ? `<div><span>Deliver to</span><strong>${escapeHtml(document.deliveryAddress)}</strong></div>` : ""}</div></section>`;
  const customerFacingDescription = document.kind === "invoice" && document.description ? `<section class="invoice-description"><p class="block-label">Description</p><p>${escapeHtml(document.description)}</p></section>` : "";
  const creditReason = document.kind === "credit_note" && document.reason ? `<section class="invoice-description"><p class="block-label">Reason for credit</p><p>${escapeHtml(document.reason)}</p></section>` : "";
  const signature = document.kind === "invoice" ? `<section class="closing"><div class="powered"><img src="/bdb-mark.svg" alt=""><span>Powered by BDB</span></div><div class="signature"><div class="signature-line"></div><strong>Client signature</strong><div class="date-line"><span>Date</span><i></i></div></div></section>` : `<section class="closing"><div class="powered"><img src="/bdb-mark.svg" alt=""><span>Powered by BDB</span></div></section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.title)} ${escapeHtml(document.number)}</title>
<style>
@page{size:A4;margin:10mm}*{box-sizing:border-box}body{margin:0;background:#eceae4;color:#161615;font-family:Arial,Helvetica,sans-serif}.sheet{position:relative;width:210mm;min-height:297mm;margin:20px auto;background:#fff;padding:15mm 16mm 13mm;box-shadow:0 18px 60px rgba(0,0,0,.14)}.document-heading{margin:0 0 25px;text-align:center;font-size:31px;font-weight:900;letter-spacing:.025em;text-transform:uppercase}.issuer-row{display:flex;align-items:flex-start;justify-content:space-between;gap:28px;min-height:105px}.issuer h1{margin:0 0 7px;font-size:20px}.issuer p{margin:2px 0;color:#4f4f4b;font-size:11px;line-height:1.45;white-space:pre-line}.business-logo{display:block;max-width:145px;max-height:78px;object-fit:contain}.rule{height:1px;margin:3px 0 17px;background:#d7d4cc}.draft{margin:0 0 17px;padding:8px 11px;border:1px dashed #aa8236;background:#fbf7ed;color:#745817;font-size:10px;font-weight:800}.bill-block{display:grid;grid-template-columns:1.2fr 1fr;gap:48px;margin-bottom:20px}.block-label{margin:0 0 7px!important;color:#171715!important;font-size:13px!important;font-weight:850;text-transform:none!important;letter-spacing:0!important}.bill-block strong{font-size:14px}.bill-block p{margin:3px 0;color:#4d4d49;font-size:11px;white-space:pre-line}.facts{display:grid;gap:7px;align-content:start}.facts div{display:grid;grid-template-columns:minmax(115px,1fr) minmax(110px,1.15fr);gap:14px;align-items:start}.facts span{text-align:right;color:#4e4e49;font-size:10px;font-weight:700}.facts strong{text-align:right;font-size:12px;white-space:pre-line}.invoice-description{margin:11px 0 18px;padding:11px 13px;border-left:3px solid #b58b35;background:#faf9f6}.invoice-description p{margin:0;color:#3e3e3a;font-size:10.5px;line-height:1.55;white-space:pre-line}.invoice-description .block-label{margin-bottom:4px!important}table{width:100%;border-collapse:collapse;margin-top:10px;font-size:9.5px}th{padding:8px 5px;background:#1c1c1a;color:#fff;text-align:left;font-size:7.5px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}th.numeric{text-align:right}td{padding:9px 5px;border-bottom:1px solid #dedbd3;vertical-align:top}.code{width:12%;color:#45453f;font-weight:700}.description{width:30%}.numeric{text-align:right;white-space:nowrap}.amount{font-weight:700}.table-note{margin:6px 0 0;color:#74716a;font-size:8px;text-align:right}.totals{width:43%;margin:22px 0 0 auto}.totals div{display:flex;justify-content:space-between;gap:18px;padding:6px 2px;border-bottom:1px solid #dedbd3;font-size:10.5px}.totals .grand{padding:9px 2px;border-bottom:2px solid #1c1c1a;font-size:13px}.closing{display:flex;align-items:flex-end;justify-content:space-between;gap:30px;margin-top:48px;min-height:100px}.powered{display:flex;align-items:center;gap:6px;color:#9a978f;font-size:7.5px;letter-spacing:.025em}.powered img{width:15px;height:15px;opacity:.58}.signature{width:245px;text-align:center}.signature-line{height:42px;border-bottom:1px solid #454540}.signature strong{display:block;margin-top:7px;font-size:10px}.date-line{display:flex;align-items:flex-end;gap:8px;margin-top:15px;color:#77736b;font-size:7.5px;text-align:left}.date-line i{flex:1;border-bottom:1px solid #bbb7ae}.actions{position:fixed;right:18px;bottom:18px}.actions button{border:0;background:#171715;color:#d4b15d;padding:11px 16px;border-radius:7px;font-weight:700;cursor:pointer}@media print{body{background:white}.sheet{width:auto;min-height:277mm;margin:0;padding:5mm 6mm 4mm;box-shadow:none}.actions{display:none}.business-logo{max-width:135px;max-height:70px}}@media(max-width:800px){.sheet{width:100%;min-height:100vh;margin:0;padding:26px}.bill-block{grid-template-columns:1fr;gap:22px}.facts div{grid-template-columns:1fr 1fr}.totals{width:100%}.closing{align-items:flex-start;flex-direction:column-reverse}.signature{width:100%;max-width:280px;margin-left:auto}.business-logo{max-width:115px}table{font-size:8.5px}th,td{padding-left:4px;padding-right:4px}}
</style></head><body>
<main class="sheet"><h1 class="document-heading">${escapeHtml(document.title)}</h1><section class="issuer-row"><div class="issuer"><h1>${escapeHtml(document.supplier.name)}</h1><p>${escapeHtml(document.supplier.address ?? "")}</p>${document.supplier.vatNumber ? `<p>VAT: ${escapeHtml(document.supplier.vatNumber)}</p>` : ""}${document.supplier.registrationNumber ? `<p>Company: ${escapeHtml(document.supplier.registrationNumber)}</p>` : ""}${supplierContact(document) ? `<p>${supplierContact(document)}</p>` : ""}</div>${document.logoUrl ? `<img class="business-logo" src="${escapeHtml(document.logoUrl)}" alt="Business logo">` : ""}</section><div class="rule"></div>${legalWarning}${customerBlock}${customerFacingDescription}${creditReason}
<table><thead><tr><th>SKU / Code</th><th>Description</th><th class="numeric">Qty</th>${priced ? '<th class="numeric">Unit Price</th><th class="numeric">Discount</th><th class="numeric">VAT</th><th class="numeric">Amount</th>' : ""}</tr></thead><tbody>${rows}</tbody></table>
${priced ? '<p class="table-note">Catalogue unit prices are shown exclusive of VAT. Any line discount is applied before VAT.</p>' : ""}${totals}${signature}</main><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>${printOnLoad ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),150))</script>' : ""}</body></html>`;
}

function pdfSafe(value: unknown) {
  return String(value ?? "")
    .replace(/[ċĊ]/g, (m) => m === "Ċ" ? "C" : "c")
    .replace(/[ġĠ]/g, (m) => m === "Ġ" ? "G" : "g")
    .replace(/[ħĦ]/g, (m) => m === "Ħ" ? "H" : "h")
    .replace(/[żŻ]/g, (m) => m === "Ż" ? "Z" : "z")
    .normalize("NFKD").replace(/[^\x20-\x7E]/g, "?")
    .replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}
function textCommand(x: number, y: number, text: string, size = 10, bold = false) { return `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${pdfSafe(text)}) Tj ET`; }
function wrapped(value: string | null | undefined, maxChars: number, maxLines = 4) {
  const words = String(value ?? "").replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  const lines: string[] = []; let current = "";
  for (const word of words) { const next = current ? `${current} ${word}` : word; if (next.length <= maxChars) current = next; else { if (current) lines.push(current); current = word.slice(0, maxChars); if (lines.length >= maxLines - 1) break; } }
  if (current && lines.length < maxLines) lines.push(current); return lines;
}
function addWrapped(content: string[], x: number, y: number, value: string | null | undefined, maxChars: number, size = 8, leading = 11, maxLines = 4, bold = false) {
  const lines = wrapped(value, maxChars, maxLines); lines.forEach((line, index) => content.push(textCommand(x, y - index * leading, line, size, bold))); return y - Math.max(lines.length, 1) * leading;
}
function addPoweredByBdb(content: string[]) {
  content.push("0.07 0.07 0.06 rg 48 27 13 13 re f"); content.push("0.72 0.55 0.20 RG 0.7 w 48 27 13 13 re S"); content.push(textCommand(52, 31, "B", 6.5, true)); content.push("0.55 g"); content.push(textCommand(67, 31, "Powered by BDB", 6.5)); content.push("0 g");
}

function documentPages(document: BusinessDocumentModel) {
  const pages: string[][] = [];
  const priced = document.kind !== "delivery_note";
  const pageLines = 24;
  const totalPages = Math.max(1, Math.ceil(Math.max(document.lines.length, 1) / pageLines));
  for (let page = 0; page < totalPages; page += 1) {
    const start = page * pageLines; const content: string[] = []; const first = page === 0;
    content.push(textCommand(250, 800, document.title.toUpperCase(), 21, true));
    content.push(textCommand(48, 762, document.supplier.name, 13, true));
    let supplierY = addWrapped(content, 48, 748, document.supplier.address, 52, 7.5, 10, 4);
    if (document.supplier.vatNumber) { content.push(textCommand(48, supplierY, `VAT: ${document.supplier.vatNumber}`, 7.5)); supplierY -= 10; }
    if (document.supplier.registrationNumber) content.push(textCommand(48, supplierY, `Company: ${document.supplier.registrationNumber}`, 7.5));
    content.push("0.72 0.55 0.20 RG 1 w 48 700 m 547 700 l S");
    if (first) {
      content.push(textCommand(48, 676, "BILL TO", 9, true)); content.push(textCommand(48, 660, document.customer.name, 11, true));
      const customerY = addWrapped(content, 48, 646, document.customer.address, 48, 8, 11, 3); if (document.customer.vatNumber) content.push(textCommand(48, customerY, `VAT: ${document.customer.vatNumber}`, 8));
      content.push(textCommand(360, 676, `${document.title} No.:`, 8, true)); content.push(textCommand(448, 676, document.draft ? "DRAFT" : document.number, 9, true));
      content.push(textCommand(360, 659, `${document.kind === "delivery_note" ? "Delivery" : document.title} date:`, 8)); content.push(textCommand(448, 659, document.date, 8));
      let referenceY = 642;
      if (document.originalInvoiceNumber) { content.push(textCommand(360, referenceY, "Original Invoice:", 8)); content.push(textCommand(448, referenceY, document.originalInvoiceNumber, 8, true)); referenceY -= 17; }
      if (document.salesOrderReference) { content.push(textCommand(360, referenceY, "SO number:", 8)); content.push(textCommand(448, referenceY, document.salesOrderReference, 8, true)); }
      if (document.draft) content.push(textCommand(48, 604, "DRAFT - Not an issued business document", 8, true));
      if (document.kind === "invoice" && document.description) { content.push(textCommand(48, 584, "DESCRIPTION", 8, true)); addWrapped(content, 48, 570, document.description, 88, 7.5, 10, 3); }
      if (document.kind === "credit_note" && document.reason) { content.push(textCommand(48, 584, "REASON FOR CREDIT", 8, true)); addWrapped(content, 48, 570, document.reason, 88, 7.5, 10, 3); }
    }
    let y = first ? 520 : 742;
    content.push("0.11 0.11 0.10 rg 48 " + (y + 5) + " 499 20 re f"); content.push("1 g");
    content.push(textCommand(52, y + 11, "SKU / Code", 6.5, true)); content.push(textCommand(112, y + 11, "Description", 6.5, true)); content.push(textCommand(292, y + 11, "Qty", 6.5, true));
    if (priced) { content.push(textCommand(326, y + 11, "Unit", 6.5, true)); content.push(textCommand(390, y + 11, "Disc.", 6.5, true)); content.push(textCommand(438, y + 11, "VAT", 6.5, true)); content.push(textCommand(492, y + 11, "Amount", 6.5, true)); }
    content.push("0 g"); y -= 8;
    const lines = document.lines.slice(start, start + pageLines);
    for (const line of lines) {
      content.push(textCommand(52, y, line.code.slice(0, 12), 6.7)); content.push(textCommand(112, y, line.description.slice(0, 32), 6.7)); content.push(textCommand(292, y, quantity(line.quantity), 6.7));
      if (priced) { content.push(textCommand(326, y, money(line.unitPrice, document.currency), 6.7)); content.push(textCommand(390, y, discount(line.discountPercent), 6.7)); content.push(textCommand(438, y, line.vatRate == null ? "-" : `${Number(line.vatRate).toFixed(2)}%`, 6.7)); content.push(textCommand(492, y, money(line.totalAmount, document.currency), 6.7)); }
      content.push("0.86 G 0.35 w 48 " + (y - 5) + " m 547 " + (y - 5) + " l S"); y -= 18;
    }
    if (page === totalPages - 1 && priced) {
      y -= 6; content.push(textCommand(365, y, document.kind === "credit_note" ? "Credit subtotal" : "Subtotal after discount", 8)); content.push(textCommand(485, y, money(document.netAmount, document.currency), 8, true));
      y -= 17; content.push(textCommand(365, y, "VAT", 8)); content.push(textCommand(485, y, money(document.vatAmount, document.currency), 8, true));
      y -= 20; content.push("0.11 0.11 0.10 RG 1.2 w 365 " + (y + 12) + " m 547 " + (y + 12) + " l S"); content.push(textCommand(365, y, document.kind === "credit_note" ? "Credit total" : "Total", 10, true)); content.push(textCommand(485, y, money(document.totalAmount, document.currency), 10, true));
      if (document.kind === "invoice") { const signatureY = Math.max(90, y - 65); content.push("0.45 G 0.6 w 350 " + signatureY + " m 535 " + signatureY + " l S"); content.push(textCommand(395, signatureY - 14, "Client signature", 8, true)); content.push(textCommand(350, signatureY - 38, "Date", 6.5)); content.push("0.55 G 0.5 w 378 " + (signatureY - 38) + " m 535 " + (signatureY - 38) + " l S"); }
    }
    if (priced) content.push(textCommand(365, 49, "Catalogue price excludes VAT; discount is applied before VAT", 6.2));
    addPoweredByBdb(content); content.push(textCommand(505, 31, `${page + 1}/${totalPages}`, 6.5)); pages.push(content);
  }
  return pages;
}

export function businessDocumentPdf(document: BusinessDocumentModel) {
  const pageContents = documentPages(document); const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>"; const kids: string[] = [];
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"; objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  pageContents.forEach((commands, index) => {
    const pageId = 5 + index * 2; const contentId = pageId + 1; kids.push(`${pageId} 0 R`); const stream = commands.join("\n");
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;
  let pdf = "%PDF-1.4\n% BDB OS\n"; const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) { offsets[id] = Buffer.byteLength(pdf, "latin1"); pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`; }
  const xref = Buffer.byteLength(pdf, "latin1"); pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`; return Buffer.from(pdf, "latin1");
}
