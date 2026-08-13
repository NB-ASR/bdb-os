import { createHash, randomUUID } from "node:crypto";

export type ParsedBankStatementRow = {
  id: string;
  transactionDate: string;
  valueDate: string | null;
  description: string;
  amount: number;
  transactionType: "credit" | "debit";
  currency: string;
  externalReference: string | null;
  fingerprint: string;
  sourceRowNumber: number;
};

export type ParsedBankStatement = {
  delimiter: "," | ";" | "\t";
  rows: ParsedBankStatementRow[];
};

const HEADER_ALIASES = {
  date: ["date", "transactiondate", "posteddate", "bookingdate"],
  valueDate: ["valuedate", "settlementdate"],
  description: ["description", "details", "narrative", "memo", "merchant", "transactiondescription"],
  amount: ["amount", "transactionamount", "value"],
  type: ["type", "direction", "transactiontype", "debitcredit", "creditdebit"],
  credit: ["credit", "moneyin", "paidin", "deposit"],
  debit: ["debit", "moneyout", "paidout", "withdrawal"],
  reference: ["reference", "ref", "transactionreference", "transactionid", "bankreference"],
  currency: ["currency", "ccy"],
} as const;

function normaliseHeader(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function chooseDelimiter(header: string): "," | ";" | "\t" {
  const candidates = [",", ";", "\t"] as const;
  let selected: "," | ";" | "\t" = ",";
  let best = -1;
  for (const candidate of candidates) {
    let count = 0;
    let quoted = false;
    for (let index = 0; index < header.length; index += 1) {
      const character = header[index];
      if (character === '"') quoted = !quoted;
      if (!quoted && character === candidate) count += 1;
    }
    if (count > best) {
      best = count;
      selected = candidate;
    }
  }
  return selected;
}

function parseCsvLine(line: string, delimiter: string) {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      values.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("The CSV contains an unterminated quoted value.");
  values.push(value.trim());
  return values;
}

function columnIndex(headers: string[], aliases: readonly string[]) {
  return headers.findIndex((header) => aliases.includes(header));
}

function parseDate(value: string, rowNumber: number, field: string) {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Row ${rowNumber}: ${field} is required.`);

  const iso = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(trimmed);
  if (iso) {
    const result = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    if (!Number.isNaN(Date.parse(`${result}T00:00:00Z`))) return result;
  }

  const dayFirst = /^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/.exec(trimmed);
  if (dayFirst) {
    const result = `${dayFirst[3]}-${dayFirst[2].padStart(2, "0")}-${dayFirst[1].padStart(2, "0")}`;
    if (!Number.isNaN(Date.parse(`${result}T00:00:00Z`))) return result;
  }

  throw new Error(`Row ${rowNumber}: ${field} must use YYYY-MM-DD or DD/MM/YYYY.`);
}

function parseOptionalDate(value: string, rowNumber: number) {
  return value.trim() ? parseDate(value, rowNumber, "value date") : null;
}

function parseAmount(value: string, rowNumber: number, field: string) {
  let normalised = value
    .trim()
    .replace(/[€£$]/g, "")
    .replace(/\s/g, "");

  if (!normalised) return 0;

  const comma = normalised.lastIndexOf(",");
  const dot = normalised.lastIndexOf(".");
  if (comma > dot) {
    normalised = normalised.replace(/\./g, "").replace(",", ".");
  } else {
    normalised = normalised.replace(/,/g, "");
  }

  if (/^\(.*\)$/.test(normalised)) normalised = `-${normalised.slice(1, -1)}`;
  const amount = Number(normalised);
  if (!Number.isFinite(amount)) throw new Error(`Row ${rowNumber}: ${field} is invalid.`);
  return amount;
}

function parseDirection(value: string) {
  const normalised = value.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (["credit", "cr", "in", "received", "deposit"].includes(normalised)) return "credit" as const;
  if (["debit", "dr", "out", "sent", "withdrawal", "payment"].includes(normalised)) return "debit" as const;
  return null;
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function hashBankStatementFile(content: Buffer) {
  return createHash("sha256").update(content).digest("hex");
}

export function parseBankStatementCsv(
  text: string,
  accountCurrency: string,
  bankAccountId: string,
  idFactory: () => string = randomUUID,
): ParsedBankStatement {
  const lines = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) throw new Error("The CSV must contain a header and at least one transaction row.");
  if (lines.length > 5001) throw new Error("The CSV exceeds the Version 1 limit of 5,000 transactions.");

  const delimiter = chooseDelimiter(lines[0]);
  const headers = parseCsvLine(lines[0], delimiter).map(normaliseHeader);

  const dateIndex = columnIndex(headers, HEADER_ALIASES.date);
  const valueDateIndex = columnIndex(headers, HEADER_ALIASES.valueDate);
  const descriptionIndex = columnIndex(headers, HEADER_ALIASES.description);
  const amountIndex = columnIndex(headers, HEADER_ALIASES.amount);
  const typeIndex = columnIndex(headers, HEADER_ALIASES.type);
  const creditIndex = columnIndex(headers, HEADER_ALIASES.credit);
  const debitIndex = columnIndex(headers, HEADER_ALIASES.debit);
  const referenceIndex = columnIndex(headers, HEADER_ALIASES.reference);
  const currencyIndex = columnIndex(headers, HEADER_ALIASES.currency);

  if (dateIndex < 0) throw new Error("The CSV needs a date column.");
  if (descriptionIndex < 0) throw new Error("The CSV needs a description column.");
  if (amountIndex < 0 && creditIndex < 0 && debitIndex < 0) {
    throw new Error("The CSV needs an amount column or separate credit/debit columns.");
  }

  const occurrence = new Map<string, number>();
  const rows: ParsedBankStatementRow[] = [];

  for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
    const sourceRowNumber = lineIndex + 1;
    const values = parseCsvLine(lines[lineIndex], delimiter);
    const get = (index: number) => index >= 0 ? String(values[index] ?? "") : "";

    const transactionDate = parseDate(get(dateIndex), sourceRowNumber, "transaction date");
    const valueDate = valueDateIndex >= 0 ? parseOptionalDate(get(valueDateIndex), sourceRowNumber) : null;
    const description = get(descriptionIndex).trim();
    if (!description || description.length > 500) {
      throw new Error(`Row ${sourceRowNumber}: description must contain 1 to 500 characters.`);
    }

    let transactionType: "credit" | "debit";
    let amount: number;

    if (creditIndex >= 0 || debitIndex >= 0) {
      const credit = Math.abs(parseAmount(get(creditIndex), sourceRowNumber, "credit amount"));
      const debit = Math.abs(parseAmount(get(debitIndex), sourceRowNumber, "debit amount"));
      if (credit > 0 && debit > 0) {
        throw new Error(`Row ${sourceRowNumber}: credit and debit cannot both contain an amount.`);
      }
      if (credit <= 0 && debit <= 0) {
        throw new Error(`Row ${sourceRowNumber}: either credit or debit must be greater than zero.`);
      }
      transactionType = credit > 0 ? "credit" : "debit";
      amount = credit > 0 ? credit : debit;
    } else {
      const signedAmount = parseAmount(get(amountIndex), sourceRowNumber, "amount");
      const explicitType = typeIndex >= 0 ? parseDirection(get(typeIndex)) : null;
      if (signedAmount === 0) throw new Error(`Row ${sourceRowNumber}: amount must not be zero.`);
      transactionType = explicitType ?? (signedAmount > 0 ? "credit" : "debit");
      amount = Math.abs(signedAmount);
    }

    const currency = (currencyIndex >= 0 ? get(currencyIndex) : accountCurrency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error(`Row ${sourceRowNumber}: currency is invalid.`);
    if (currency !== accountCurrency.toUpperCase()) {
      throw new Error(`Row ${sourceRowNumber}: currency ${currency} does not match the Bank account currency ${accountCurrency.toUpperCase()}.`);
    }

    const externalReference = referenceIndex >= 0 ? get(referenceIndex).trim() || null : null;
    if (externalReference && externalReference.length > 200) {
      throw new Error(`Row ${sourceRowNumber}: reference exceeds 200 characters.`);
    }

    const baseFingerprint = [
      bankAccountId,
      transactionDate,
      valueDate ?? "",
      transactionType,
      amount.toFixed(4),
      description.toLowerCase().replace(/\s+/g, " "),
      externalReference?.toLowerCase() ?? "",
    ].join("|");
    const nextOccurrence = (occurrence.get(baseFingerprint) ?? 0) + 1;
    occurrence.set(baseFingerprint, nextOccurrence);

    rows.push({
      id: idFactory(),
      transactionDate,
      valueDate,
      description,
      amount: Number(amount.toFixed(4)),
      transactionType,
      currency,
      externalReference,
      fingerprint: digest(`${baseFingerprint}|${nextOccurrence}`),
      sourceRowNumber,
    });
  }

  return { delimiter, rows };
}
