"use client";

import { useMemo, useRef, useState, type ChangeEvent } from "react";
import { Download, FileUp, TriangleAlert } from "lucide-react";
import { Button, Dialog } from "@/components/ui";
import {
  importValue,
  numericImportValue,
  parseCsv,
  sha256Hex,
  stableImportUuid,
  type CsvRecord,
} from "@/lib/modules/standard-csv-import";

type ImportEntity = "customers" | "products" | "services";

type StandardDataImportProps = {
  entity: ImportEntity;
  workspaceId: string | null;
  disabled?: boolean;
};

type RowFailure = { row: number; message: string };
type PreviewRow = { row: number; label: string; secondary: string; payload: Record<string, unknown> };

type PreparedImport = {
  fileName: string;
  fileHash: string;
  rows: PreviewRow[];
  failures: RowFailure[];
};

const MAX_STANDARD_ROWS = 1000;
const TEMPLATE_HEADERS: Record<ImportEntity, string[]> = {
  customers: ["name", "code", "company", "email", "phone", "address", "vat_number", "preferences"],
  products: ["sku", "name", "barcode", "brand", "category", "purpose", "unit_label", "unit_cost", "selling_price", "vat_rate", "reorder_level", "notes"],
  services: ["code", "name", "category", "duration_minutes", "preparation_buffer_minutes", "recovery_buffer_minutes", "price", "vat_rate", "booking_mode", "description", "notes"],
};

function entityLabel(entity: ImportEntity) {
  return entity === "customers" ? "Customers" : entity === "products" ? "Products" : "Services";
}

function csvCell(value: string) {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function templateExample(entity: ImportEntity) {
  if (entity === "customers") return ["Jane Borg", "", "Vanita", "jane@example.com", "+356 20000000", "Valletta", "MT12345678", "VIP customer"];
  if (entity === "products") return ["SKU-001", "Example Product", "", "", "Retail", "resale", "unit", "10.00", "20.00", "18", "2", ""];
  return ["SRV-001", "Example Service", "Beauty", "60", "0", "0", "35.00", "18", "customer", "", ""];
}

function downloadTemplate(entity: ImportEntity) {
  const rows = [TEMPLATE_HEADERS[entity], templateExample(entity)];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `bdb-os-${entity}-import-template.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function customerPayload(row: CsvRecord) {
  const name = importValue(row, ["name", "customer", "customer_name", "contact_name", "client"]);
  if (!name) throw new Error("Customer name is required.");
  const email = importValue(row, ["email", "email_address"]);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Email address is invalid.");
  return {
    code: importValue(row, ["code", "customer_code", "client_code"]),
    name,
    company: importValue(row, ["company", "business", "organisation", "organization"]),
    email,
    phone: importValue(row, ["phone", "telephone", "mobile", "mobile_number"]),
    address: importValue(row, ["address", "postal_address"]),
    vatNumber: importValue(row, ["vat_number", "vat", "tax_number"]),
    preferences: importValue(row, ["preferences", "notes"]) ? { summary: importValue(row, ["preferences", "notes"]) } : {},
    allowDuplicate: false,
  };
}

function productPayload(row: CsvRecord) {
  const sku = importValue(row, ["sku", "product_code", "code"]);
  const name = importValue(row, ["name", "product", "product_name", "description"]);
  if (!sku) throw new Error("SKU is required.");
  if (!name) throw new Error("Product name is required.");
  const purposeRaw = importValue(row, ["purpose", "classification", "type"]).toLowerCase();
  if (purposeRaw && !["resale", "supply", "supplies"].includes(purposeRaw)) throw new Error("Purpose must be resale or supply.");
  const purpose = purposeRaw === "supply" || purposeRaw === "supplies" ? "supply" : "resale";
  const unitCost = numericImportValue(importValue(row, ["unit_cost", "cost", "purchase_cost"]), 0);
  const sellingPrice = numericImportValue(importValue(row, ["selling_price", "sale_price", "price", "rrp"]), null);
  const vatRate = numericImportValue(importValue(row, ["vat_rate", "vat", "vat_percent"]), 18);
  const reorderLevel = numericImportValue(importValue(row, ["reorder_level", "reorder_at", "minimum_stock"]), 0);
  if ([unitCost, sellingPrice, vatRate, reorderLevel].some((value) => typeof value === "number" && Number.isNaN(value))) {
    throw new Error("One or more Product numeric values are invalid.");
  }
  if (Number(vatRate) < 0 || Number(vatRate) > 100) throw new Error("VAT rate must be between 0 and 100.");
  return {
    sku,
    name,
    barcode: importValue(row, ["barcode", "ean", "gtin"]),
    brand: importValue(row, ["brand"]),
    category: importValue(row, ["category"]),
    purpose,
    unitLabel: importValue(row, ["unit_label", "unit"]) || "unit",
    unitCost,
    sellingPrice,
    vatRate,
    reorderLevel,
    notes: importValue(row, ["notes"]),
  };
}

function servicePayload(row: CsvRecord) {
  const code = importValue(row, ["code", "service_code", "sku"]);
  const name = importValue(row, ["name", "service", "service_name", "description"]);
  if (!code) throw new Error("Service code is required.");
  if (!name) throw new Error("Service name is required.");
  const durationMinutes = numericImportValue(importValue(row, ["duration_minutes", "duration", "minutes"]), 60);
  const preparationBufferMinutes = numericImportValue(importValue(row, ["preparation_buffer_minutes", "preparation_buffer", "prep_buffer"]), 0);
  const recoveryBufferMinutes = numericImportValue(importValue(row, ["recovery_buffer_minutes", "recovery_buffer", "cleanup_buffer"]), 0);
  const price = numericImportValue(importValue(row, ["price", "selling_price"]), null);
  const vatRate = numericImportValue(importValue(row, ["vat_rate", "vat", "vat_percent"]), 18);
  if ([durationMinutes, preparationBufferMinutes, recoveryBufferMinutes, price, vatRate].some((value) => typeof value === "number" && Number.isNaN(value))) {
    throw new Error("One or more Service numeric values are invalid.");
  }
  if (!Number.isInteger(durationMinutes) || Number(durationMinutes) < 5 || Number(durationMinutes) > 1440) throw new Error("Duration must be 5–1440 whole minutes.");
  if (!Number.isInteger(preparationBufferMinutes) || Number(preparationBufferMinutes) < 0 || Number(preparationBufferMinutes) > 240) throw new Error("Preparation buffer must be 0–240 whole minutes.");
  if (!Number.isInteger(recoveryBufferMinutes) || Number(recoveryBufferMinutes) < 0 || Number(recoveryBufferMinutes) > 240) throw new Error("Recovery buffer must be 0–240 whole minutes.");
  if (Number(vatRate) < 0 || Number(vatRate) > 100) throw new Error("VAT rate must be between 0 and 100.");
  const bookingModeRaw = importValue(row, ["booking_mode", "booking_visibility", "visibility"]).toLowerCase();
  if (bookingModeRaw && !["customer", "staff", "staff_only"].includes(bookingModeRaw)) throw new Error("Booking mode must be customer or staff.");
  return {
    code,
    name,
    category: importValue(row, ["category"]),
    durationMinutes,
    preparationBufferMinutes,
    recoveryBufferMinutes,
    price,
    vatRate,
    bookingMode: bookingModeRaw === "staff" || bookingModeRaw === "staff_only" ? "staff" : "customer",
    description: importValue(row, ["description"]),
    notes: importValue(row, ["notes"]),
  };
}

function payloadFor(entity: ImportEntity, row: CsvRecord) {
  if (entity === "customers") return customerPayload(row);
  if (entity === "products") return productPayload(row);
  return servicePayload(row);
}

function previewFor(entity: ImportEntity, payload: Record<string, unknown>) {
  if (entity === "customers") {
    return { label: String(payload.name), secondary: String(payload.email || payload.phone || payload.company || "No contact detail") };
  }
  if (entity === "products") {
    return { label: String(payload.name), secondary: `${String(payload.sku)} · ${String(payload.purpose)}` };
  }
  return { label: String(payload.name), secondary: `${String(payload.code)} · ${String(payload.durationMinutes)} min` };
}

async function createRecord(entity: ImportEntity, workspaceId: string, id: string, idempotencyKey: string, payload: Record<string, unknown>) {
  const endpoint = entity === "customers" ? "/api/customers" : entity === "products" ? "/api/products" : "/api/services";
  let lastError = "Import failed.";
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ workspaceId, action: "create", id, ...payload }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok && result.ok) return;
      lastError = typeof result.error === "string" ? result.error : `Import failed with status ${response.status}.`;
      if (response.status >= 400 && response.status < 500) throw new Error(lastError);
    } catch (error) {
      lastError = error instanceof Error ? error.message : lastError;
      if (attempt === 1) throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}

export function StandardDataImport({ entity, workspaceId, disabled = false }: StandardDataImportProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const label = entityLabel(entity);
  const previewRows = useMemo(() => prepared?.rows.slice(0, 8) ?? [], [prepared]);

  async function prepareFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    if (!workspaceId) {
      setStatus("An active workspace is required.");
      return;
    }
    if (!navigator.onLine) {
      setStatus(`${label} bulk import is online-only so duplicate checks use current shared data.`);
      return;
    }
    if (file.size > 5_000_000) {
      setStatus("Choose a CSV smaller than 5 MB.");
      return;
    }

    setStatus("");
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length > MAX_STANDARD_ROWS) throw new Error(`Import no more than ${MAX_STANDARD_ROWS} ${label} at once.`);
      const failures: RowFailure[] = [];
      const validRows: PreviewRow[] = [];
      rows.forEach((row, index) => {
        try {
          const payload = payloadFor(entity, row);
          const preview = previewFor(entity, payload);
          validRows.push({ row: index + 2, payload, ...preview });
        } catch (error) {
          failures.push({ row: index + 2, message: error instanceof Error ? error.message : "Row is invalid." });
        }
      });
      if (!validRows.length) throw new Error(failures[0]?.message ?? "No valid rows were found in this CSV.");
      setPrepared({ fileName: file.name, fileHash: await sha256Hex(text), rows: validRows, failures });
    } catch (error) {
      setPrepared(null);
      setStatus(error instanceof Error ? error.message : `${label} CSV could not be read.`);
    }
  }

  async function confirmImport() {
    if (!prepared || !workspaceId || busy) return;
    if (!navigator.onLine) {
      setStatus(`${label} bulk import requires a connection so duplicate checks use current shared data.`);
      return;
    }

    setBusy(true);
    const failures: RowFailure[] = [...prepared.failures];
    let created = 0;
    for (const row of prepared.rows) {
      try {
        const seed = `${workspaceId}:${entity}:${prepared.fileHash}:${row.row}`;
        const id = await stableImportUuid(seed);
        const idempotencyKey = `stdimp:${entity}:${prepared.fileHash}:${row.row}`;
        await createRecord(entity, workspaceId, id, idempotencyKey, row.payload);
        created += 1;
      } catch (error) {
        failures.push({ row: row.row, message: error instanceof Error ? error.message : "Row could not be imported." });
      }
    }

    setPrepared(null);
    setBusy(false);
    if (failures.length) {
      const first = failures.slice(0, 5).map((failure) => `row ${failure.row}: ${failure.message}`).join(" · ");
      setStatus(`${created} imported · ${failures.length} need review. ${first}`);
      if (created > 0) window.setTimeout(() => window.location.reload(), 1800);
    } else {
      setStatus(`${created} ${label} imported successfully. Refreshing…`);
      window.setTimeout(() => window.location.reload(), 600);
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <input ref={inputRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => void prepareFile(event)} />
        <Button variant="secondary" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
          <FileUp size={17} /> {busy ? "Importing…" : `Import ${label}`}
        </Button>
        <Button type="button" variant="quiet" disabled={busy} onClick={() => downloadTemplate(entity)} title={`Download ${label} CSV template`}>
          <Download size={16} /> Template
        </Button>
        {status ? <span role="status" style={{ maxWidth: 460, fontSize: 12, opacity: 0.82 }}>{status}</span> : null}
      </div>

      <Dialog
        open={Boolean(prepared)}
        onClose={() => { if (!busy) setPrepared(null); }}
        title={`Review ${label} import`}
        description="Nothing is created until you confirm this review. Rows with invalid required fields are excluded and listed below."
      >
        {prepared ? (
          <div style={{ display: "grid", gap: 16 }}>
            <div className="settings-note">
              <strong>{prepared.fileName}</strong>
              <p>{prepared.rows.length} valid row{prepared.rows.length === 1 ? "" : "s"} ready · {prepared.failures.length} row{prepared.failures.length === 1 ? "" : "s"} need correction.</p>
            </div>
            <div className="table-scroll">
              <table>
                <thead><tr><th>CSV row</th><th>{entity === "customers" ? "Customer" : entity === "products" ? "Product" : "Service"}</th><th>Details</th></tr></thead>
                <tbody>{previewRows.map((row) => <tr key={row.row}><td>{row.row}</td><td><strong>{row.label}</strong></td><td>{row.secondary}</td></tr>)}</tbody>
              </table>
            </div>
            {prepared.rows.length > previewRows.length ? <p className="muted">Previewing the first {previewRows.length} of {prepared.rows.length} valid rows.</p> : null}
            {prepared.failures.length ? (
              <div className="review-callout">
                <TriangleAlert size={18} />
                <div><strong>Rows excluded from this import</strong><p>{prepared.failures.slice(0, 8).map((failure) => `Row ${failure.row}: ${failure.message}`).join(" · ")}</p></div>
              </div>
            ) : null}
            <div className="dialog-actions">
              <Button type="button" variant="quiet" disabled={busy} onClick={() => setPrepared(null)}>Cancel</Button>
              <Button type="button" disabled={busy} onClick={() => void confirmImport()}>{busy ? "Importing…" : `Confirm ${prepared.rows.length} ${label}`}</Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
