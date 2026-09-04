export type CsvRecord = Record<string, string>;

const RECOGNISED_IMPORT_HEADERS = new Set([
  "name", "customer", "customer_name", "client", "client_name", "contact_name",
  "email", "email_address", "phone", "phone_number", "phone_numbers", "telephone", "mobile", "mobile_number",
  "address", "postal_address", "company", "business", "organisation", "organization", "code", "customer_code", "client_code",
  "sku", "product", "product_name", "product_code", "service", "service_name", "service_code", "description",
  "barcode", "brand", "category", "purpose", "unit_cost", "selling_price", "price", "vat_rate", "duration_minutes",
]);

function detectDelimiter(line: string) {
  const candidates = [",", ";", "\t"];
  let best = ",";
  let bestCount = -1;
  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') quoted = !quoted;
      else if (!quoted && char === candidate) count += 1;
    }
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }
  return best;
}

function parseRows(text: string, delimiter: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"') {
      if (quoted && next === '"') {
        field += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (!quoted && char === delimiter) {
      row.push(field);
      field = "";
      continue;
    }
    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      field = "";
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  if (quoted) throw new Error("The CSV contains an unfinished quoted field.");
  return rows;
}

export function normaliseImportHeader(value: string) {
  return value
    .replace(/^\uFEFF/, "")
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[%()]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function recordsFromRows(rows: string[][], allowPreamble: boolean) {
  if (rows.length < 2) throw new Error("The file must contain a header row and at least one data row.");

  let headerIndex = 0;
  if (allowPreamble) {
    const candidate = rows.findIndex((row) => {
      const headers = row.map(normaliseImportHeader).filter(Boolean);
      const recognised = headers.filter((header) => RECOGNISED_IMPORT_HEADERS.has(header)).length;
      return headers.length >= 2 && recognised >= 2;
    });
    if (candidate < 0) throw new Error("BDB OS could not find a recognised Customer, Product or Service header row in this workbook.");
    headerIndex = candidate;
  }

  const headers = rows[headerIndex].map(normaliseImportHeader);
  if (headers.some((header) => !header)) throw new Error("Every import column needs a header.");
  if (new Set(headers).size !== headers.length) throw new Error("The import contains duplicate column headers.");

  return rows.slice(headerIndex + 1)
    .filter((values) => values.some((value) => String(value ?? "").trim()))
    .map((values) => Object.fromEntries(
      headers.map((header, index) => [header, String(values[index] ?? "").trim()]),
    ));
}

export function parseCsv(text: string): CsvRecord[] {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  return recordsFromRows(parseRows(source, delimiter), false);
}

function decodeXml(value: string) {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function xmlText(fragment: string) {
  return [...fragment.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map((match) => decodeXml(match[1]))
    .join("");
}

function columnIndex(reference: string) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() ?? "A";
  let index = 0;
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64;
  return Math.max(0, index - 1);
}

type ZipEntry = {
  name: string;
  compression: number;
  compressedSize: number;
  localHeaderOffset: number;
};

function findZipEntries(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocd = -1;
  const floor = Math.max(0, bytes.length - 65_557);
  for (let offset = bytes.length - 22; offset >= floor; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("The XLSX ZIP directory could not be read.");

  const entryCount = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries = new Map<string, ZipEntry>();

  for (let index = 0; index < entryCount; index += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) throw new Error("The XLSX ZIP directory is invalid.");
    const compression = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(bytes.slice(offset + 46, offset + 46 + fileNameLength));
    entries.set(name, { name, compression, compressedSize, localHeaderOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipText(buffer: ArrayBuffer, entry: ZipEntry) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const offset = entry.localHeaderOffset;
  if (view.getUint32(offset, true) !== 0x04034b50) throw new Error("The XLSX ZIP entry is invalid.");
  const fileNameLength = view.getUint16(offset + 26, true);
  const extraLength = view.getUint16(offset + 28, true);
  const start = offset + 30 + fileNameLength + extraLength;
  const compressed = bytes.slice(start, start + entry.compressedSize);

  let output: ArrayBuffer;
  if (entry.compression === 0) {
    output = compressed.slice().buffer as ArrayBuffer;
  } else if (entry.compression === 8) {
    const Decompression = DecompressionStream as unknown as { new(format: string): TransformStream<Uint8Array, Uint8Array> };
    const stream = new Blob([compressed as BlobPart]).stream().pipeThrough(new Decompression("deflate-raw"));
    output = await new Response(stream).arrayBuffer();
  } else {
    throw new Error(`Unsupported XLSX compression method ${entry.compression}.`);
  }
  return new TextDecoder().decode(output);
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<CsvRecord[]> {
  const entries = findZipEntries(buffer);
  const sheetEntry = [...entries.values()]
    .filter((entry) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name))[0];
  if (!sheetEntry) throw new Error("The XLSX workbook does not contain a worksheet.");

  const sharedEntry = entries.get("xl/sharedStrings.xml");
  const sharedStrings = sharedEntry
    ? [...(await readZipText(buffer, sharedEntry)).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)].map((match) => xmlText(match[1]))
    : [];
  const sheet = await readZipText(buffer, sheetEntry);
  const rows: string[][] = [];

  for (const rowMatch of sheet.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const values: string[] = [];
    let fallbackColumn = 0;
    for (const cellMatch of rowMatch[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attributes = cellMatch[1];
      const body = cellMatch[2];
      const reference = attributes.match(/\br="([A-Z]+\d+)"/i)?.[1];
      const index = reference ? columnIndex(reference) : fallbackColumn;
      fallbackColumn = index + 1;
      const type = attributes.match(/\bt="([^"]+)"/)?.[1] ?? "";
      const raw = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/)?.[1] ?? "";
      if (type === "s") values[index] = sharedStrings[Number(raw)] ?? "";
      else if (type === "inlineStr") values[index] = xmlText(body);
      else values[index] = decodeXml(raw);
    }
    if (values.some((value) => String(value ?? "").trim())) rows.push(values.map((value) => value ?? ""));
  }

  return recordsFromRows(rows, true);
}

export function importValue(row: CsvRecord, aliases: readonly string[]) {
  for (const alias of aliases) {
    const value = row[normaliseImportHeader(alias)];
    if (value !== undefined && value !== "") return value;
  }
  return "";
}

export function numericImportValue(value: string, fallback: number | null = null) {
  const cleaned = value.trim().replace(/[^0-9+\-.,]/g, "").replace(/,(?=\d{1,2}$)/, ".").replace(/,/g, "");
  if (!cleaned) return fallback;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export async function stableImportUuid(seed: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(seed)));
  const id = bytes.slice(0, 16);
  id[6] = (id[6] & 0x0f) | 0x50;
  id[8] = (id[8] & 0x3f) | 0x80;
  const hex = [...id].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function sha256Hex(value: string | ArrayBuffer) {
  const source = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", source));
  return [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("");
}
