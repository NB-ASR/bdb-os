import { normaliseImportHeader, type CsvRecord } from "@/lib/modules/standard-csv-import";

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const LOCAL_SIGNATURE = 0x04034b50;
const MAX_ENTRY_BYTES = 30_000_000;
const RECOGNISED_HEADERS = new Set([
  "name", "full_name", "customer", "customer_name", "client", "client_name", "contact_name",
  "first_name", "firstname", "given_name", "forename", "last_name", "lastname", "surname", "family_name",
  "email", "email_address", "phone", "phone_number", "phone_numbers", "phone_no", "telephone", "mobile", "mobile_number", "mobile_no",
  "address", "postal_address", "address_line_1", "street_address", "city", "town", "locality",
  "company", "business", "organisation", "organization", "code", "customer_code", "client_code",
  "vat_number", "vat", "tax_number", "preferences", "notes",
]);
const NAME_HEADERS = new Set([
  "name", "full_name", "customer", "customer_name", "client", "client_name", "contact_name",
  "first_name", "firstname", "given_name", "forename", "last_name", "lastname", "surname", "family_name",
]);
type ImportHeader = { index: number; score: number; equallyLikely: number };

function decode(bytes: Uint8Array) {
  return new TextDecoder("utf-8").decode(bytes);
}

function columnIndex(reference: string) {
  const letters = reference.replace(/[^A-Za-z].*$/, "").toUpperCase();
  let result = 0;
  for (const letter of letters) result = result * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, result - 1);
}

function normaliseZipPath(path: string) {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
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
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));

    if (name === entryName) {
      if (uncompressedSize > MAX_ENTRY_BYTES) throw new Error("The Excel workbook expands beyond the supported import size.");
      if (view.getUint32(localOffset, true) !== LOCAL_SIGNATURE) throw new Error("The Excel workbook entry is invalid.");
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const compressed = bytes.slice(dataStart, dataStart + compressedSize);
      if (compressed.length !== compressedSize || dataStart + compressedSize > buffer.byteLength) throw new Error("The Excel workbook entry is truncated.");
      if (method === 0) return compressed;
      if (method !== 8) throw new Error("This Excel compression format is not supported.");
      const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = stream.getReader();
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          length += value.length;
          if (length > MAX_ENTRY_BYTES) {
            await reader.cancel();
            throw new Error("The Excel workbook expands beyond the supported import size.");
          }
          chunks.push(value);
        }
      } finally {
        reader.releaseLock();
      }
      const output = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
      return output;
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
  const clean = target.replace(/^\//, "");
  return normaliseZipPath(clean.startsWith("xl/") ? clean : `xl/${clean}`);
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

function worksheetMatrix(worksheet: Document, shared: string[]) {
  return Array.from(worksheet.getElementsByTagName("row")).map((row) => {
    const values: string[] = [];
    for (const cell of Array.from(row.getElementsByTagName("c"))) {
      const reference = cell.getAttribute("r") ?? "A1";
      values[columnIndex(reference)] = cellText(cell, shared).trim();
    }
    return values;
  }).filter((row) => row.some((value) => String(value ?? "").trim()));
}

export function findImportHeader(matrix: string[][]): ImportHeader | null {
  let bestIndex = -1;
  let bestScore = -1;
  let equallyLikely = 0;
  for (let index = 0; index < matrix.length; index += 1) {
    const headers = matrix[index].map((value) => normaliseImportHeader(String(value ?? ""))).filter(Boolean);
    const recognised = headers.filter((header) => RECOGNISED_HEADERS.has(header));
    const hasName = recognised.some((header) => NAME_HEADERS.has(header));
    if (headers.length < 2 || recognised.length < 2 || !hasName) continue;
    if (recognised.length > bestScore) {
      bestIndex = index;
      bestScore = recognised.length;
      equallyLikely = 1;
    } else if (recognised.length === bestScore) {
      equallyLikely += 1;
    }
  }
  return bestIndex >= 0 ? { index: bestIndex, score: bestScore, equallyLikely } : null;
}

export function recordsFromImportMatrix(matrix: string[][]): CsvRecord[] {
  const nonEmpty = matrix.filter((row) => row.some((value) => String(value ?? "").trim()));
  if (nonEmpty.length < 2) throw new Error("The Excel worksheet must contain a Customer header row and at least one data row.");
  const header = findImportHeader(nonEmpty);
  if (!header) throw new Error("BDB OS could not find a recognised Customer header row in this worksheet.");
  if (header.equallyLikely > 1) throw new Error("The Excel worksheet contains multiple equally likely Customer header rows. Keep one Customer table per worksheet.");

  const rawHeaders = nonEmpty[header.index];
  const lastHeaderColumn = rawHeaders.reduce((last, value, index) => String(value ?? "").trim() ? index : last, -1);
  const headers = rawHeaders.slice(0, lastHeaderColumn + 1).map((value) => normaliseImportHeader(String(value ?? "")));
  const namedHeaders = headers.filter(Boolean);
  if (new Set(namedHeaders).size !== namedHeaders.length) throw new Error("The Excel worksheet contains duplicate column headers.");

  return nonEmpty.slice(header.index + 1)
    .filter((values) => values.some((value) => String(value ?? "").trim()))
    .map((values) => {
      const record: CsvRecord = {};
      headers.forEach((headerName, index) => {
        if (headerName) record[headerName] = String(values[index] ?? "").trim();
      });
      return record;
    });
}

export async function parseXlsx(file: File): Promise<CsvRecord[]> {
  const buffer = await file.arrayBuffer();
  const workbookBytes = await unzipEntry(buffer, "xl/workbook.xml");
  const relsBytes = await unzipEntry(buffer, "xl/_rels/workbook.xml.rels");
  if (!workbookBytes || !relsBytes) throw new Error("The Excel workbook is missing its worksheet definition.");

  const workbook = xml(decode(workbookBytes));
  const rels = xml(decode(relsBytes));
  const sharedBytes = await unzipEntry(buffer, "xl/sharedStrings.xml");
  const shared = sharedStrings(sharedBytes ? xml(decode(sharedBytes)) : null);
  const sheets = Array.from(workbook.getElementsByTagName("sheet"));
  if (!sheets.length) throw new Error("The Excel workbook does not contain a worksheet.");

  const candidates: Array<{ matrix: string[][]; header: ImportHeader; sheetName: string }> = [];
  for (const sheet of sheets) {
    if (sheet.getAttribute("state") === "hidden" || sheet.getAttribute("state") === "veryHidden") continue;
    const relationshipId = sheet.getAttribute("r:id")
      ?? sheet.getAttributeNS("http://schemas.openxmlformats.org/officeDocument/2006/relationships", "id")
      ?? "";
    if (!relationshipId) continue;
    const worksheetPath = relationshipTarget(rels, relationshipId);
    const worksheetBytes = await unzipEntry(buffer, worksheetPath);
    if (!worksheetBytes) continue;
    const matrix = worksheetMatrix(xml(decode(worksheetBytes)), shared);
    const candidate = findImportHeader(matrix);
    if (candidate) candidates.push({ matrix, header: candidate, sheetName: sheet.getAttribute("name") ?? "unnamed worksheet" });
  }

  if (!candidates.length) {
    throw new Error("BDB OS could not find a visible worksheet with recognised Customer columns. Use common headings such as Name or First Name/Last Name plus Email, Phone or Address.");
  }
  const bestScore = Math.max(...candidates.map((candidate) => candidate.header.score));
  const bestCandidates = candidates.filter((candidate) => candidate.header.score === bestScore);
  if (bestCandidates.length > 1) {
    const names = bestCandidates.map((candidate) => candidate.sheetName).join(", ");
    throw new Error(`The Excel workbook has multiple equally likely Customer worksheets (${names}). Keep one Customer table or hide the worksheets that should not be imported.`);
  }
  return recordsFromImportMatrix(bestCandidates[0].matrix);
}
