import { normaliseImportHeader, type CsvRecord } from "@/lib/modules/standard-csv-import";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const RECOGNISED_HEADERS = new Set([
  "name", "full_name", "customer", "customer_name", "client", "client_name", "contact_name",
  "email", "email_address", "phone", "phone_number", "phone_numbers", "telephone", "mobile", "mobile_number",
  "address", "postal_address", "company", "business", "organisation", "organization", "code", "customer_code", "client_code",
  "sku", "product", "product_name", "product_code", "service", "service_name", "service_code", "description",
]);

function decode(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
}

function columnIndex(reference: string) {
  const letters = reference.replace(/[^A-Za-z].*$/, "").toUpperCase();
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

async function unzipEntry(buffer: ArrayBuffer, entryName: string) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let eocd = -1;
  for (let offset = Math.max(0, bytes.length - 65_557); offset <= bytes.length - 22; offset += 1) {
    if (view.getUint32(offset, true) === EOCD_SIGNATURE) eocd = offset;
  }
  if (eocd < 0) throw new Error("The Excel workbook is not a valid XLSX file.");

  const entries = view.getUint16(eocd + 10, true);
  let cursor = view.getUint32(eocd + 16, true);
  for (let index = 0; index < entries; index += 1) {
    if (view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) throw new Error("The Excel workbook directory is invalid.");
    const method = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));

    if (name === entryName) {
      if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error("The Excel workbook entry is invalid.");
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      if (method === 0) return compressed;
      if (method !== 8) throw new Error("This Excel compression format is not supported.");
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return null;
}

function xml(text: string) {
  const document = new DOMParser().parseFromString(text, "application/xml");
  if (document.querySelector("parsererror")) throw new Error("The Excel workbook contains invalid XML.");
  return document;
}

function relationshipTarget(rels: Document, relationshipId: string) {
  const relationship = Array.from(rels.getElementsByTagName("Relationship")).find((node) => node.getAttribute("Id") === relationshipId);
  const target = relationship?.getAttribute("Target") ?? "";
  if (!target) throw new Error("The Excel workbook worksheet could not be resolved.");
  const clean = target.replace(/^\//, "").replace(/^\.\//, "");
  return clean.startsWith("xl/") ? clean : `xl/${clean}`;
}

function sharedStrings(document: Document | null) {
  if (!document) return [] as string[];
  return Array.from(document.getElementsByTagName("si")).map((node) =>
    Array.from(node.getElementsByTagName("t")).map((text) => text.textContent ?? "").join(""),
  );
}

function cellText(cell: Element, shared: string[]) {
  const type = cell.getAttribute("t") ?? "";
  if (type === "inlineStr") return Array.from(cell.getElementsByTagName("t")).map((node) => node.textContent ?? "").join("");
  const raw = cell.getElementsByTagName("v")[0]?.textContent ?? "";
  if (type === "s") return shared[Number(raw)] ?? "";
  if (type === "b") return raw === "1" ? "TRUE" : "FALSE";
  return raw;
}

function findHeaderIndex(matrix: string[][]) {
  return matrix.findIndex((row) => {
    const headers = row.map((value) => normaliseImportHeader(String(value ?? ""))).filter(Boolean);
    const recognised = headers.filter((header) => RECOGNISED_HEADERS.has(header)).length;
    return headers.length >= 2 && recognised >= 2;
  });
}

export async function parseXlsx(file: File): Promise<CsvRecord[]> {
  const buffer = await file.arrayBuffer();
  const workbookBytes = await unzipEntry(buffer, "xl/workbook.xml");
  const relsBytes = await unzipEntry(buffer, "xl/_rels/workbook.xml.rels");
  if (!workbookBytes || !relsBytes) throw new Error("The Excel workbook is missing its worksheet definition.");

  const workbook = xml(decode(workbookBytes));
  const rels = xml(decode(relsBytes));
  const sheets = Array.from(workbook.getElementsByTagName("sheet"));
  const sheet = sheets.find((node) => node.getAttribute("state") !== "hidden") ?? sheets[0];
  if (!sheet) throw new Error("The Excel workbook does not contain a worksheet.");
  const relationshipId = sheet.getAttribute("r:id") ?? sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id") ?? "";
  const worksheetPath = relationshipTarget(rels, relationshipId);
  const worksheetBytes = await unzipEntry(buffer, worksheetPath);
  if (!worksheetBytes) throw new Error("The Excel worksheet could not be read.");

  const sharedBytes = await unzipEntry(buffer, "xl/sharedStrings.xml");
  const shared = sharedStrings(sharedBytes ? xml(decode(sharedBytes)) : null);
  const worksheet = xml(decode(worksheetBytes));
  const matrix = Array.from(worksheet.getElementsByTagName("row")).map((row) => {
    const values: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const reference = cell.getAttribute("r") ?? "A1";
      values[columnIndex(reference)] = cellText(cell, shared).trim();
    }
    return values;
  }).filter((row) => row.some((value) => String(value ?? "").trim()));

  if (matrix.length < 2) throw new Error("The Excel worksheet must contain a header row and at least one data row.");
  const headerIndex = findHeaderIndex(matrix);
  if (headerIndex < 0) throw new Error("BDB OS could not find a recognised Customer, Product or Service header row in this workbook.");

  const rawHeaders = matrix[headerIndex];
  const lastHeaderColumn = rawHeaders.reduce((last, value, index) => String(value ?? "").trim() ? index : last, -1);
  const headers = rawHeaders.slice(0, lastHeaderColumn + 1).map((value) => normaliseImportHeader(String(value ?? "")));
  if (headers.some((header) => !header)) throw new Error("Every Excel column needs a header.");
  if (new Set(headers).size !== headers.length) throw new Error("The Excel worksheet contains duplicate column headers.");

  return matrix.slice(headerIndex + 1)
    .filter((values) => values.some((value) => String(value ?? "").trim()))
    .map((values) => {
      const record: CsvRecord = {};
      headers.forEach((header, index) => { record[header] = String(values[index] ?? "").trim(); });
      return record;
    });
}
