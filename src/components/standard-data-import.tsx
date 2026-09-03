"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { Download, FileUp } from "lucide-react";
import { Button } from "@/components/ui";
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
  return {
    code: importValue(row, ["code", "customer_code", "client_code"]),
    name,
    company: importValue(row, ["company", "business", "organisation", "organization"]),
    email: importValue(row, ["email", "email_address"]),
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
  const purpose = purposeRaw === "supply" || purposeRaw === "supplies" ? "supply" : "resale";
  const unitCost = numericImportValue(importValue(row, ["unit_cost", "cost", "purchase_cost"]), 0);
  const sellingPrice = numericImportValue(importValue(row, ["selling_price", "sale_price", "price", "rrp"]), null);
  const vatRate = numericImportValue(importValue(row, ["vat_rate", "vat", "vat_percent"]), 18);
  const reorderLevel = numericImportValue(importValue(row, ["reorder_level", "reorder_at", "minimum_stock"]), 0);
  if ([unitCost, sellingPrice, vatRate, reorderLevel].some((value) => typeof value === "number" && Number.isNaN(value))) {
    throw new Error("One or more Product numeric values are invalid.");
  }
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
  const bookingModeRaw = importValue(row, ["booking_mode", "booking_visibility", "visibility"]).toLowerCase();
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

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || busy) return;
    if (!workspaceId) {
      setStatus("An active workspace is required.");
      return;
    }
    if (!navigator.onLine) {
      setStatus(`${entityLabel(entity)} bulk import is online-only so duplicate checks use current shared data.`);
      return;
    }
    if (file.size > 5_000_000) {
      setStatus("Choose a CSV smaller than 5 MB.");
      return;
    }

    setBusy(true);
    setStatus("");
    try {
      const text = await file.text();
      const rows = parseCsv(text);
      if (rows.length > MAX_STANDARD_ROWS) throw new Error(`Import no more than ${MAX_STANDARD_ROWS} ${entityLabel(entity)} at once.`);
      const fileHash = await sha256Hex(text);
      const failures: RowFailure[] = [];
      let created = 0;

      for (let index = 0; index < rows.length; index += 1) {
        try {
          const payload = payloadFor(entity, rows[index]);
          const seed = `${workspaceId}:${entity}:${fileHash}:${index + 1}`;
          const id = await stableImportUuid(seed);
          const idempotencyKey = `standard-import:${entity}:${fileHash}:${index + 1}`;
          await createRecord(entity, workspaceId, id, idempotencyKey, payload);
          created += 1;
        } catch (error) {
          failures.push({ row: index + 2, message: error instanceof Error ? error.message : "Row could not be imported." });
        }
      }

      if (failures.length) {
        const first = failures.slice(0, 3).map((failure) => `row ${failure.row}: ${failure.message}`).join(" · ");
        setStatus(`${created} imported · ${failures.length} need review. ${first}`);
      } else {
        setStatus(`${created} ${entityLabel(entity)} imported successfully. Refreshing…`);
        window.setTimeout(() => window.location.reload(), 600);
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `${entityLabel(entity)} could not be imported.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
      <input ref={inputRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => void importFile(event)} />
      <Button variant="secondary" disabled={disabled || busy} onClick={() => inputRef.current?.click()}>
        <FileUp size={17} /> {busy ? "Importing…" : `Import ${entityLabel(entity)}`}
      </Button>
      <Button type="button" variant="quiet" disabled={busy} onClick={() => downloadTemplate(entity)} title={`Download ${entityLabel(entity)} CSV template`}>
        <Download size={16} /> Template
      </Button>
      {status ? <span style={{ maxWidth: 420, fontSize: 12, opacity: 0.8 }}>{status}</span> : null}
    </div>
  );
}
