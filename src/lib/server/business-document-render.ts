export type BusinessDocumentKind = "invoice" | "credit_note" | "delivery_note";

export type BusinessDocumentLine = {
  code: string;
  description: string;
  quantity: number;
  unitPrice?: number | null;
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
  dueDate?: string | null;
  supplyDate?: string | null;
  originalInvoiceNumber?: string | null;
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
  paidAmount?: number | null;
  balanceAmount?: number | null;
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

function detail(label: string, value?: string | null) {
  if (!value) return "";
  return `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

export function businessDocumentHtml(document: BusinessDocumentModel, printOnLoad = false) {
  const priced = document.kind !== "delivery_note";
  const rows = document.lines.map((line) => `
    <tr>
      <td class="code">${escapeHtml(line.code)}</td>
      <td>${escapeHtml(line.description)}</td>
      <td class="number">${quantity(line.quantity)}</td>
      ${priced ? `<td class="number">${money(line.unitPrice, document.currency)}</td><td class="number">${line.vatRate == null ? "—" : `${Number(line.vatRate).toFixed(2)}%`}</td><td class="number">${money(line.totalAmount, document.currency)}</td>` : ""}
    </tr>`).join("");

  const totals = priced ? `
    <section class="totals">
      <div><span>Net</span><strong>${money(document.netAmount, document.currency)}</strong></div>
      <div><span>VAT</span><strong>${money(document.vatAmount, document.currency)}</strong></div>
      <div class="grand"><span>${document.kind === "credit_note" ? "Credit total" : "Total"}</span><strong>${money(document.totalAmount, document.currency)}</strong></div>
      ${document.kind === "invoice" && document.balanceAmount != null ? `<div><span>Balance due</span><strong>${money(document.balanceAmount, document.currency)}</strong></div>` : ""}
    </section>` : "";

  const legalWarning = document.draft ? `<div class="draft">DRAFT · Not an issued business document</div>` : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.title)} ${escapeHtml(document.number)}</title>
<style>
@page{size:A4;margin:14mm}*{box-sizing:border-box}body{margin:0;background:#ece9e0;color:#191917;font-family:Arial,Helvetica,sans-serif}.sheet{width:210mm;min-height:297mm;margin:22px auto;background:#fff;padding:18mm;box-shadow:0 18px 60px rgba(0,0,0,.14)}header{display:flex;justify-content:space-between;gap:24px;border-bottom:2px solid #9a7a32;padding-bottom:22px}.brand{display:flex;gap:16px;align-items:flex-start}.logo{max-width:135px;max-height:65px;object-fit:contain}.brand h1{font-size:21px;margin:0 0 7px}.brand p,.muted{margin:2px 0;color:#666;font-size:12px;white-space:pre-line}.document-title{text-align:right}.document-title h2{font-size:28px;letter-spacing:.03em;margin:0 0 8px}.document-title strong{font-size:15px}.draft{margin:18px 0;padding:9px 12px;border:1px dashed #9a7a32;background:#faf6ea;color:#715717;font-weight:700;font-size:12px}.parties{display:grid;grid-template-columns:1fr 1fr;gap:32px;margin:28px 0}.parties h3{font-size:11px;letter-spacing:.13em;text-transform:uppercase;color:#806428;margin:0 0 10px}.parties strong{font-size:15px}.meta{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:20px 0}.meta div{border-top:1px solid #ddd;padding-top:8px}.meta span{display:block;color:#777;font-size:10px;text-transform:uppercase;letter-spacing:.08em}.meta strong{display:block;margin-top:4px;font-size:12px}table{width:100%;border-collapse:collapse;margin-top:26px;font-size:11px}th{padding:9px 7px;border-bottom:1px solid #9a7a32;text-align:left;text-transform:uppercase;letter-spacing:.06em;font-size:9px;color:#6e5724}td{padding:10px 7px;border-bottom:1px solid #e8e5dc;vertical-align:top}.code{width:15%;color:#666}.number{text-align:right;white-space:nowrap}.totals{width:45%;margin:26px 0 0 auto}.totals div{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #e6e2d7;font-size:12px}.totals .grand{font-size:15px;border-bottom:2px solid #9a7a32;padding:11px 0}.note{margin-top:30px;font-size:11px;white-space:pre-line}.footer{position:relative;margin-top:46px;padding-top:14px;border-top:1px solid #ddd;color:#777;font-size:10px;white-space:pre-line}.actions{position:fixed;right:18px;bottom:18px}.actions button{border:0;background:#171715;color:#d4b15d;padding:11px 16px;border-radius:7px;font-weight:700;cursor:pointer}@media print{body{background:white}.sheet{width:auto;min-height:auto;margin:0;padding:0;box-shadow:none}.actions{display:none}}@media(max-width:800px){.sheet{width:100%;min-height:100vh;margin:0;padding:24px}.parties,.meta{grid-template-columns:1fr}.totals{width:100%}}
</style></head><body>
<main class="sheet">
<header><div class="brand">${document.logoUrl ? `<img class="logo" src="${escapeHtml(document.logoUrl)}" alt="Business logo">` : ""}<div><h1>${escapeHtml(document.supplier.name)}</h1><p>${escapeHtml(document.supplier.address ?? "")}</p><p>${document.supplier.vatNumber ? `VAT: ${escapeHtml(document.supplier.vatNumber)}` : ""}${document.supplier.registrationNumber ? `<br>Company: ${escapeHtml(document.supplier.registrationNumber)}` : ""}</p></div></div><div class="document-title"><h2>${escapeHtml(document.title)}</h2><strong>${escapeHtml(document.draft ? "Draft" : document.number)}</strong></div></header>
${legalWarning}
<section class="parties"><div><h3>Customer</h3><strong>${escapeHtml(document.customer.name)}</strong><p class="muted">${escapeHtml(document.customer.address ?? "")}</p>${document.customer.vatNumber ? `<p class="muted">VAT: ${escapeHtml(document.customer.vatNumber)}</p>` : ""}</div><div><h3>${document.kind === "delivery_note" ? "Delivery" : "Document details"}</h3>${document.kind === "delivery_note" ? `<strong>${escapeHtml(document.deliveryAddress ?? document.customer.address ?? "")}</strong>` : `<p class="muted">${document.originalInvoiceNumber ? `Original Invoice: ${escapeHtml(document.originalInvoiceNumber)}` : ""}</p>`}</div></section>
<section class="meta">${detail("Date", document.date)}${detail("Due date", document.dueDate)}${detail("Supply date", document.supplyDate)}${detail("Reference", document.originalInvoiceNumber)}${detail("Reason", document.reason)}</section>
<table><thead><tr><th>Code</th><th>Description</th><th class="number">Qty</th>${priced ? '<th class="number">Unit price</th><th class="number">VAT</th><th class="number">Total</th>' : ""}</tr></thead><tbody>${rows}</tbody></table>
${totals}
${document.reason && document.kind === "credit_note" ? `<div class="note"><strong>Reason for credit</strong><br>${escapeHtml(document.reason)}</div>` : ""}
${document.footer ? `<footer class="footer">${escapeHtml(document.footer)}</footer>` : ""}
</main><div class="actions"><button onclick="window.print()">Print / Save as PDF</button></div>${printOnLoad ? '<script>window.addEventListener("load",()=>setTimeout(()=>window.print(),150))</script>' : ""}</body></html>`;
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

function textCommand(x: number, y: number, text: string, size = 10, bold = false) {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${pdfSafe(text)}) Tj ET`;
}

function documentPages(document: BusinessDocumentModel) {
  const pages: string[][] = [];
  const pageLines = 31;
  for (let start = 0; start < Math.max(document.lines.length, 1); start += pageLines) {
    const content: string[] = [];
    const first = start === 0;
    content.push("0.58 0.45 0.17 RG 1.4 w 48 770 m 547 770 l S");
    content.push(textCommand(48, 795, document.supplier.name, 15, true));
    content.push(textCommand(48, 779, document.supplier.address ?? "", 8));
    content.push(textCommand(547, 795, document.title.toUpperCase(), 19, true));
    content.push(textCommand(547, 778, document.draft ? "DRAFT" : document.number, 10, true));
    if (first) {
      content.push(textCommand(48, 738, `Customer: ${document.customer.name}`, 10, true));
      content.push(textCommand(48, 723, document.customer.address ?? "", 8));
      if (document.customer.vatNumber) content.push(textCommand(48, 709, `Customer VAT: ${document.customer.vatNumber}`, 8));
      content.push(textCommand(360, 738, `Date: ${document.date}`, 9));
      if (document.dueDate) content.push(textCommand(360, 723, `Due: ${document.dueDate}`, 9));
      if (document.originalInvoiceNumber) content.push(textCommand(360, 709, `Original Invoice: ${document.originalInvoiceNumber}`, 9));
    }
    let y = first ? 675 : 735;
    content.push("0.75 G 0.5 w 48 " + (y + 12) + " m 547 " + (y + 12) + " l S");
    content.push(textCommand(48, y + 18, "Code", 8, true));
    content.push(textCommand(120, y + 18, "Description", 8, true));
    content.push(textCommand(390, y + 18, "Qty", 8, true));
    if (document.kind !== "delivery_note") content.push(textCommand(465, y + 18, "Total", 8, true));
    for (const line of document.lines.slice(start, start + pageLines)) {
      content.push(textCommand(48, y, line.code.slice(0, 16), 8));
      content.push(textCommand(120, y, line.description.slice(0, 52), 8));
      content.push(textCommand(390, y, quantity(line.quantity), 8));
      if (document.kind !== "delivery_note") content.push(textCommand(465, y, money(line.totalAmount, document.currency), 8));
      y -= 18;
    }
    if (start + pageLines >= document.lines.length && document.kind !== "delivery_note") {
      y -= 8;
      content.push("0.58 0.45 0.17 RG 1 w 360 " + (y + 10) + " m 547 " + (y + 10) + " l S");
      content.push(textCommand(360, y - 6, "Net", 9));
      content.push(textCommand(465, y - 6, money(document.netAmount, document.currency), 9, true));
      content.push(textCommand(360, y - 23, "VAT", 9));
      content.push(textCommand(465, y - 23, money(document.vatAmount, document.currency), 9, true));
      content.push(textCommand(360, y - 43, document.kind === "credit_note" ? "Credit total" : "Total", 11, true));
      content.push(textCommand(465, y - 43, money(document.totalAmount, document.currency), 11, true));
      if (document.kind === "invoice" && document.balanceAmount != null) {
        content.push(textCommand(360, y - 62, "Balance due", 10, true));
        content.push(textCommand(465, y - 62, money(document.balanceAmount, document.currency), 10, true));
      }
    }
    content.push(textCommand(48, 42, document.footer ?? "Generated by BDB OS", 7));
    pages.push(content);
  }
  return pages;
}

export function businessDocumentPdf(document: BusinessDocumentModel) {
  const pageContents = documentPages(document);
  const objects: string[] = [];
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  const kids: string[] = [];
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";
  pageContents.forEach((commands, index) => {
    const pageId = 5 + index * 2;
    const contentId = pageId + 1;
    kids.push(`${pageId} 0 R`);
    const stream = commands.join("\n");
    objects[contentId] = `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`;
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
  });
  objects[2] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`;

  let pdf = "%PDF-1.4\n% BDB OS\n";
  const offsets: number[] = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(pdf, "latin1");
    pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) pdf += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}
