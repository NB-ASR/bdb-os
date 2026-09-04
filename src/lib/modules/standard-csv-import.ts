export type CsvRecord = Record<string, string>;

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

export function parseCsv(text: string): CsvRecord[] {
  const source = text.replace(/^\uFEFF/, "");
  const firstLine = source.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = detectDelimiter(firstLine);
  const rows = parseRows(source, delimiter);
  if (rows.length < 2) throw new Error("The CSV must contain a header row and at least one data row.");

  const headers = rows[0].map(normaliseImportHeader);
  if (headers.some((header) => !header)) throw new Error("Every CSV column needs a header.");
  if (new Set(headers).size !== headers.length) throw new Error("The CSV contains duplicate column headers.");

  return rows.slice(1).map((values) => Object.fromEntries(
    headers.map((header, index) => [header, String(values[index] ?? "").trim()]),
  ));
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

export async function sha256Hex(value: string) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
  return [...bytes].map((item) => item.toString(16).padStart(2, "0")).join("");
}
