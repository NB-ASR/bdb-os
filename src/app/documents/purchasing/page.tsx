"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDollarSign,
  Eye,
  FileCheck2,
  FileText,
  Link2,
  PackageCheck,
  Plus,
  RefreshCw,
  ScanLine,
  Search,
  Sparkles,
  Trash2,
  TriangleAlert,
  UploadCloud,
  WalletCards,
  WifiOff,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatMoney } from "@/lib/format";
import {
  enqueueSupplierDocumentUpload,
  failSupplierDocumentUpload,
  listSupplierDocumentUploads,
  removeSupplierDocumentUpload,
  submitSupplierDocumentUpload,
  type PendingSupplierDocumentUpload,
} from "@/lib/modules/purchasing-upload-queue";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import styles from "./purchasing.module.css";

type DocumentFilter = "all" | "review" | "approved" | "failed";
type DocumentStatus = "uploaded" | "extracting" | "review_required" | "approved" | "extraction_failed" | "archived";

type SupplierDocument = {
  id: string;
  workspace_id: string;
  supplier_id: string | null;
  supplier: { id: string; code: string; name: string } | null;
  document_type: "invoice" | "credit_note" | "other";
  document_number: string | null;
  document_date: string | null;
  due_date: string | null;
  currency: string;
  subtotal_before_discount: number | string | null;
  discount_amount: number | string | null;
  net_after_discount: number | string | null;
  vat_rate: number | string | null;
  vat_amount: number | string | null;
  gross_amount: number | string | null;
  extracted_supplier_text: string | null;
  file_name: string;
  status: DocumentStatus;
  extraction_status: "pending" | "processing" | "completed" | "failed";
  extraction_confidence: number | string | null;
  extraction_notes: string[];
  inventory_posting_status: "not_available";
  accounts_posting_status: "not_available";
  version: number;
  created_at: string;
  updated_at: string;
  line_count: number;
  attention_count: number;
};

type SupplierOption = {
  id: string;
  code: string;
  name: string;
  supplier_type: string;
  document_currency: string;
  payment_terms_days: number;
};

type ProductOption = { id: string; sku: string; name: string; barcode: string | null };
type RelationshipOption = { id: string; product_id: string; supplier_id: string; supplier_sku: string | null };

type ReviewLine = {
  id: string;
  lineKind: "product" | "expense";
  description: string;
  supplierSku: string;
  barcode: string;
  quantity: string;
  unitCost: string;
  rrp: string;
  matchedProductId: string;
  matchedProductSupplierId: string;
  notes: string;
};

type ReviewHeader = {
  supplierId: string;
  documentType: "invoice" | "credit_note" | "other";
  documentNumber: string;
  documentDate: string;
  dueDate: string;
  currency: string;
  subtotalBeforeDiscount: string;
  discountAmount: string;
  netAfterDiscount: string;
  vatRate: string;
  vatAmount: string;
  grossAmount: string;
};

type ReviewState = {
  document: SupplierDocument;
  suppliers: SupplierOption[];
  products: ProductOption[];
  relationships: RelationshipOption[];
  originalFileUrl: string;
  header: ReviewHeader;
  lines: ReviewLine[];
};

type PendingReviewCommand = {
  id: string;
  workspaceId: string;
  documentId: string;
  expectedVersion: number;
  header: ReviewHeader;
  lines: ReviewLine[];
  createdAt: string;
  attempts: number;
  lastError?: string;
};

const REGISTER_CACHE_PREFIX = "bdb-purchasing-documents-cache-v1";
const REVIEW_CACHE_PREFIX = "bdb-purchasing-review-cache-v1";
const REVIEW_QUEUE_PREFIX = "bdb-purchasing-review-queue-v1";
const LAST_WORKSPACE_KEY = "bdb-purchasing-last-workspace-v1";

function registerCacheKey(workspaceId: string) {
  return `${REGISTER_CACHE_PREFIX}:${workspaceId}`;
}

function reviewCacheKey(workspaceId: string, documentId: string) {
  return `${REVIEW_CACHE_PREFIX}:${workspaceId}:${documentId}`;
}

function reviewQueueKey(workspaceId: string) {
  return `${REVIEW_QUEUE_PREFIX}:${workspaceId}`;
}

function readLastWorkspace() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_WORKSPACE_KEY);
}

function readRegisterCache(workspaceId: string): SupplierDocument[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(registerCacheKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed as SupplierDocument[] : [];
  } catch {
    return [];
  }
}

function writeRegisterCache(workspaceId: string, documents: SupplierDocument[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
  window.localStorage.setItem(registerCacheKey(workspaceId), JSON.stringify(documents));
}

function readReviewCache(workspaceId: string, documentId: string): ReviewState | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(reviewCacheKey(workspaceId, documentId)) ?? "null") as ReviewState | null;
    return parsed ? { ...parsed, originalFileUrl: "" } : null;
  } catch {
    return null;
  }
}

function writeReviewCache(workspaceId: string, review: ReviewState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    reviewCacheKey(workspaceId, review.document.id),
    JSON.stringify({ ...review, originalFileUrl: "" }),
  );
}

function readReviewQueue(workspaceId: string): PendingReviewCommand[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(reviewQueueKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed as PendingReviewCommand[] : [];
  } catch {
    return [];
  }
}

function writeReviewQueue(workspaceId: string, commands: PendingReviewCommand[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(reviewQueueKey(workspaceId), JSON.stringify(commands));
}

function valueString(value: number | string | null | undefined) {
  return value === null || value === undefined ? "" : String(value);
}

function createBlankLine(): ReviewLine {
  return {
    id: crypto.randomUUID(),
    lineKind: "product",
    description: "",
    supplierSku: "",
    barcode: "",
    quantity: "1",
    unitCost: "",
    rrp: "",
    matchedProductId: "",
    matchedProductSupplierId: "",
    notes: "",
  };
}

function documentTypeLabel(type: SupplierDocument["document_type"]) {
  if (type === "invoice") return "Supplier invoice";
  if (type === "credit_note") return "Credit note";
  return "Unclassified";
}

function statusLabel(document: SupplierDocument) {
  if (document.status === "uploaded") return "Waiting to scan";
  if (document.status === "extracting") return "Extracting";
  if (document.status === "review_required") return document.attention_count ? "Needs matching" : "Ready to review";
  if (document.status === "approved") return "Approved";
  if (document.status === "extraction_failed") return "Scan failed";
  return "Archived";
}

function statusTone(document: SupplierDocument) {
  if (document.status === "approved") return "green" as const;
  if (document.status === "extracting") return "blue" as const;
  if (document.status === "extraction_failed" || document.attention_count) return "gold" as const;
  return "neutral" as const;
}

function dateLabel(value: string | null) {
  if (!value) return "Not confirmed";
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-GB").format(date);
}

function fileSizeLabel(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

function buildReview(result: Record<string, unknown>): ReviewState {
  const document = result.document as SupplierDocument;
  const lines = (result.lines ?? []) as Array<Record<string, unknown>>;
  return {
    document,
    suppliers: (result.suppliers ?? []) as SupplierOption[],
    products: (result.products ?? []) as ProductOption[],
    relationships: (result.relationships ?? []) as RelationshipOption[],
    originalFileUrl: String(result.originalFileUrl ?? ""),
    header: {
      supplierId: document.supplier_id ?? "",
      documentType: document.document_type,
      documentNumber: document.document_number ?? "",
      documentDate: document.document_date ?? "",
      dueDate: document.due_date ?? "",
      currency: document.currency,
      subtotalBeforeDiscount: valueString(document.subtotal_before_discount),
      discountAmount: valueString(document.discount_amount),
      netAfterDiscount: valueString(document.net_after_discount),
      vatRate: valueString(document.vat_rate),
      vatAmount: valueString(document.vat_amount),
      grossAmount: valueString(document.gross_amount),
    },
    lines: lines.map((line) => ({
      id: String(line.id),
      lineKind: line.line_kind === "expense" ? "expense" : "product",
      description: String(line.printed_description ?? ""),
      supplierSku: String(line.supplier_sku ?? ""),
      barcode: String(line.barcode ?? ""),
      quantity: valueString(line.quantity as string | number | null),
      unitCost: valueString(line.unit_cost as string | number | null),
      rrp: valueString(line.rrp as string | number | null),
      matchedProductId: String(line.matched_product_id ?? ""),
      matchedProductSupplierId: String(line.matched_product_supplier_id ?? ""),
      notes: String(line.notes ?? ""),
    })),
  };
}

export default function PurchasingPage() {
  const { state, role, mode } = useBdb();
  const [documents, setDocuments] = useState<SupplierDocument[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<DocumentFilter>("all");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [pendingUploads, setPendingUploads] = useState<PendingSupplierDocumentUpload[]>([]);
  const [pendingReviewCount, setPendingReviewCount] = useState(0);
  const [activeReviewCommand, setActiveReviewCommand] = useState<{ action: "save_review" | "approve"; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [scanningId, setScanningId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const supportMode = role === "platform-support";
  const cloudMode = mode === "cloud";

  useEffect(() => {
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const loadLocalState = useCallback(async (currentWorkspaceId: string) => {
    if (typeof indexedDB !== "undefined") {
      setPendingUploads(await listSupplierDocumentUploads(currentWorkspaceId));
    }
    setPendingReviewCount(readReviewQueue(currentWorkspaceId).length);
  }, []);

  const loadCloud = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }
    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    const response = await fetch(`/api/purchasing/documents?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Purchasing documents could not be loaded.");
    const cloudDocuments = (result.result?.documents ?? []) as SupplierDocument[];
    setDocuments(cloudDocuments);
    writeRegisterCache(currentWorkspaceId, cloudDocuments);
    await loadLocalState(currentWorkspaceId);
    return currentWorkspaceId;
  }, [loadLocalState]);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = cloudMode ? readLastWorkspace() : "demo";
      const cached = fallbackWorkspace ? readRegisterCache(fallbackWorkspace) : [];
      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        setDocuments(cached);
        await loadLocalState(fallbackWorkspace).catch(() => undefined);
      }
      try {
        setError("");
        if (!cloudMode) return;
        if (!window.navigator.onLine) {
          setNotice(cached.length
            ? "Showing the last cached Purchasing register. New files and review drafts can remain local."
            : "Purchasing needs one online load before its register can reopen offline.");
          return;
        }
        await loadCloud();
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Purchasing documents could not be loaded.";
        if (cached.length) setNotice("Showing the last cached Purchasing register while cloud access is unavailable.");
        else setError(message);
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [cloudMode, loadCloud, loadLocalState]);

  useEffect(() => {
    if (workspaceId && review) writeReviewCache(workspaceId, review);
  }, [review, workspaceId]);

  const openDocument = useCallback(async (documentId: string) => {
    if (!workspaceId || workspaceId === "demo") return;
    setBusy(true);
    setError("");
    try {
      if (!online) {
        const cached = readReviewCache(workspaceId, documentId);
        if (!cached) throw new Error("Open this document once online before reviewing it offline.");
        setReview(cached);
        setNotice("Showing the cached review draft. Save Review will queue changes locally; approval requires internet.");
        return;
      }
      const response = await fetch(`/api/purchasing/documents/${documentId}?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The supplier document could not be opened.");
      const nextReview = buildReview(result.result);
      setReview(nextReview);
      writeReviewCache(workspaceId, nextReview);
    } catch (detailError) {
      setError(detailError instanceof Error ? detailError.message : "The supplier document could not be opened.");
    } finally {
      setBusy(false);
    }
  }, [online, workspaceId]);

  const scanDocument = useCallback(async (documentId: string, openAfter = true) => {
    if (!workspaceId || workspaceId === "demo" || supportMode) return false;
    if (!online) {
      setError("Document extraction requires an internet connection.");
      return false;
    }
    setScanningId(documentId);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/purchasing/documents/${documentId}/extract`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The document could not be scanned.");
      await loadCloud();
      setNotice("The supplier document was extracted. Review every field and line before approval.");
      if (openAfter) await openDocument(documentId);
      return true;
    } catch (scanError) {
      setError(scanError instanceof Error ? scanError.message : "The supplier document could not be scanned.");
      await loadCloud().catch(() => undefined);
      return false;
    } finally {
      setScanningId(null);
    }
  }, [loadCloud, online, openDocument, supportMode, workspaceId]);

  const syncPendingReviews = useCallback(async (currentWorkspaceId: string) => {
    if (!online || supportMode) return 0;
    const queue = readReviewQueue(currentWorkspaceId);
    let completed = 0;
    for (const command of queue) {
      try {
        const response = await fetch(`/api/purchasing/documents/${command.documentId}`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Idempotency-Key": command.id,
          },
          body: JSON.stringify({
            workspaceId: currentWorkspaceId,
            action: "save_review",
            expectedVersion: command.expectedVersion,
            header: command.header,
            lines: command.lines,
          }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error ?? "A queued review could not be saved.");
        writeReviewQueue(currentWorkspaceId, readReviewQueue(currentWorkspaceId).filter((item) => item.id !== command.id));
        completed += 1;
      } catch (queueError) {
        const message = queueError instanceof Error ? queueError.message : "A queued review could not be saved.";
        writeReviewQueue(currentWorkspaceId, readReviewQueue(currentWorkspaceId).map((item) => item.id === command.id
          ? { ...item, attempts: item.attempts + 1, lastError: message }
          : item));
        setError(message);
        break;
      }
    }
    setPendingReviewCount(readReviewQueue(currentWorkspaceId).length);
    return completed;
  }, [online, supportMode]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || busy || !online) return;
    setBusy(true);
    setError("");
    let uploaded = 0;
    const queuedUploads = await listSupplierDocumentUploads(workspaceId);
    for (const item of queuedUploads) {
      try {
        await submitSupplierDocumentUpload(item);
        await removeSupplierDocumentUpload(item.id);
        uploaded += 1;
        await scanDocument(item.documentId, false);
      } catch (queueError) {
        const message = queueError instanceof Error ? queueError.message : "The queued document could not be uploaded.";
        await failSupplierDocumentUpload(item, message);
        setError(message);
        break;
      }
    }
    const reviews = await syncPendingReviews(workspaceId);
    await loadCloud().catch(() => undefined);
    await loadLocalState(workspaceId);
    if (uploaded || reviews) {
      setNotice(`${uploaded} upload${uploaded === 1 ? "" : "s"} and ${reviews} review draft${reviews === 1 ? "" : "s"} synced.`);
    }
    setBusy(false);
  }, [busy, loadCloud, loadLocalState, online, scanDocument, syncPendingReviews, workspaceId]);

  useEffect(() => {
    if (cloudMode && online) void syncPending();
  }, [cloudMode, online, syncPending]);

  async function uploadDocument(event: FormEvent) {
    event.preventDefault();
    if (!selectedFile || !workspaceId || workspaceId === "demo" || supportMode || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    const documentId = crypto.randomUUID();
    const queueId = crypto.randomUUID();
    try {
      const item = await enqueueSupplierDocumentUpload(workspaceId, documentId, selectedFile, state.settings.currency, queueId);
      await loadLocalState(workspaceId);
      setUploadOpen(false);
      setSelectedFile(null);
      if (!online) {
        setNotice("Document retained offline. BDB OS will upload it when the connection returns; extraction requires internet.");
        return;
      }
      await submitSupplierDocumentUpload(item);
      await removeSupplierDocumentUpload(item.id);
      await loadLocalState(workspaceId);
      await loadCloud();
      setNotice("Original document stored privately. Automatic extraction is starting.");
      await scanDocument(documentId, true);
    } catch (uploadError) {
      const message = uploadError instanceof Error ? uploadError.message : "The supplier document could not be uploaded.";
      setError(message);
      await loadLocalState(workspaceId).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  async function discardUpload(id: string) {
    if (!workspaceId || busy) return;
    await removeSupplierDocumentUpload(id);
    await loadLocalState(workspaceId);
    setNotice("The local pending document was removed. No cloud record was created by this action.");
  }

  function resetReviewCommand() {
    setActiveReviewCommand(null);
  }

  function updateLine(index: number, patch: Partial<ReviewLine>) {
    resetReviewCommand();
    setReview((current) => {
      if (!current) return current;
      const lines = current.lines.map((line, lineIndex) => {
        if (lineIndex !== index) return line;
        const next = { ...line, ...patch };
        if (patch.lineKind === "expense") {
          next.matchedProductId = "";
          next.matchedProductSupplierId = "";
        }
        if (patch.matchedProductId !== undefined) {
          next.matchedProductSupplierId = current.relationships.find(
            (relationship) => relationship.product_id === patch.matchedProductId
              && relationship.supplier_id === current.header.supplierId,
          )?.id ?? "";
        }
        return next;
      });
      return { ...current, lines };
    });
  }

  function updateHeader(patch: Partial<ReviewHeader>) {
    resetReviewCommand();
    setReview((current) => {
      if (!current) return current;
      const header = { ...current.header, ...patch };
      const selectedSupplier = patch.supplierId === undefined
        ? null
        : current.suppliers.find((supplier) => supplier.id === patch.supplierId);
      if (selectedSupplier && !current.header.currency) header.currency = selectedSupplier.document_currency;
      const lines = patch.supplierId === undefined ? current.lines : current.lines.map((line) => ({
        ...line,
        matchedProductSupplierId: current.relationships.find(
          (relationship) => relationship.product_id === line.matchedProductId
            && relationship.supplier_id === header.supplierId,
        )?.id ?? "",
      }));
      return { ...current, header, lines };
    });
  }

  function addLine() {
    resetReviewCommand();
    setReview((current) => current ? { ...current, lines: [...current.lines, createBlankLine()] } : current);
  }

  function removeLine(index: number) {
    resetReviewCommand();
    setReview((current) => current ? { ...current, lines: current.lines.filter((_, lineIndex) => lineIndex !== index) } : current);
  }

  async function saveReview(action: "save_review" | "approve") {
    if (!review || !workspaceId || workspaceId === "demo" || supportMode || busy) return;
    if (!online) {
      if (action === "approve") {
        setError("Approval requires an internet connection so BDB OS can validate the current shared record.");
        return;
      }
      const command: PendingReviewCommand = {
        id: crypto.randomUUID(),
        workspaceId,
        documentId: review.document.id,
        expectedVersion: review.document.version,
        header: review.header,
        lines: review.lines,
        createdAt: new Date().toISOString(),
        attempts: 0,
      };
      const queue = readReviewQueue(workspaceId).filter((item) => item.documentId !== review.document.id);
      writeReviewQueue(workspaceId, [...queue, command]);
      setPendingReviewCount(readReviewQueue(workspaceId).length);
      writeReviewCache(workspaceId, review);
      setNotice("Review draft saved locally. BDB OS will validate and sync it when connectivity returns.");
      return;
    }

    setBusy(true);
    setError("");
    setNotice("");
    const command = activeReviewCommand?.action === action
      ? activeReviewCommand
      : { action, key: crypto.randomUUID() };
    setActiveReviewCommand(command);
    try {
      const response = await fetch(`/api/purchasing/documents/${review.document.id}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": command.key,
        },
        body: JSON.stringify({
          workspaceId,
          action,
          expectedVersion: review.document.version,
          header: review.header,
          lines: review.lines,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The supplier document review could not be saved.");
      setActiveReviewCommand(null);
      writeReviewQueue(workspaceId, readReviewQueue(workspaceId).filter((item) => item.documentId !== review.document.id));
      await loadCloud();
      setNotice(action === "approve"
        ? "Supplier document approved. Inventory and Accounts posting remain unavailable until their ledgers are connected."
        : "Supplier document review saved.");
      await openDocument(review.document.id);
    } catch (reviewError) {
      setError(reviewError instanceof Error ? reviewError.message : "The supplier document review could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const visibleDocuments = useMemo(() => {
    const term = query.trim().toLowerCase();
    return documents.filter((document) => {
      const matchesSearch = !term || [
        document.document_number,
        document.file_name,
        document.supplier?.name,
        document.supplier?.code,
        document.extracted_supplier_text,
        document.document_type,
        document.status,
      ].join(" ").toLowerCase().includes(term);
      const matchesFilter = filter === "all"
        || (filter === "review" && ["uploaded", "review_required", "extracting"].includes(document.status))
        || (filter === "approved" && document.status === "approved")
        || (filter === "failed" && document.status === "extraction_failed");
      return matchesSearch && matchesFilter;
    });
  }, [documents, filter, query]);

  const awaitingReview = documents.filter((document) => document.status === "review_required" || document.status === "uploaded").length;
  const approved = documents.filter((document) => document.status === "approved").length;
  const approvedValue = documents
    .filter((document) => document.status === "approved")
    .reduce((total, document) => total + Number(document.gross_amount ?? 0), 0);
  const unresolvedReviewLines = review?.lines.filter((line) => line.lineKind === "product" && !line.matchedProductId).length ?? 0;
  const invalidReviewLines = review?.lines.filter((line) => !line.description.trim() || !(Number(line.quantity) > 0)).length ?? 0;
  const canApprove = Boolean(
    review
      && online
      && review.header.supplierId
      && ["invoice", "credit_note"].includes(review.header.documentType)
      && review.header.documentNumber.trim()
      && review.header.documentDate
      && /^[A-Z]{3}$/.test(review.header.currency)
      && review.lines.length
      && unresolvedReviewLines === 0
      && invalidReviewLines === 0
      && !supportMode
      && !busy
      && review.document.status !== "approved",
  );

  if (!loaded) return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Purchasing…</main>;

  return (
    <>
      <PageHeader
        eyebrow="Supplier documents"
        title="Purchasing"
        description="Capture supplier invoices and credit notes, review extracted data and approve one shared source document before downstream posting."
        action={(
          <div className={styles.headerActions}>
            <Button onClick={() => setUploadOpen(true)} disabled={supportMode || !cloudMode}>
              <UploadCloud size={17} /> Upload or scan document
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <Sparkles size={19} />
        <div>
          <strong>Functional supplier-document capture</strong>
          <p>Original files are stored privately. Extraction is a review draft; human approval is mandatory and does not alter Inventory or Accounts.</p>
        </div>
      </div>

      {!online ? (
        <div className={styles.offlineNotice}>
          <WifiOff size={18} />
          <div><strong>Working offline</strong><span>New files and review drafts can remain local. Extraction and approval resume after reconnection.</span></div>
        </div>
      ) : null}

      {error ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Purchasing needs attention</strong><p>{error}</p></div></div> : null}
      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Purchasing updated</strong><p>{notice}</p></div> : null}

      {pendingUploads.length || pendingReviewCount ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong>{pendingUploads.length} file{pendingUploads.length === 1 ? "" : "s"} and {pendingReviewCount} review draft{pendingReviewCount === 1 ? "" : "s"} waiting to sync</strong>
          <p>Pending items remain in this browser. Conflicts stop synchronisation instead of overwriting shared records.</p>
          {pendingUploads.length ? (
            <div className={styles.pendingList}>
              {pendingUploads.map((item) => (
                <div className={styles.pendingItem} key={item.id}>
                  <div className={styles.pendingMeta}>
                    <strong>{item.fileName}</strong>
                    <span>{fileSizeLabel(item.file.size)} · {item.attempts ? `${item.attempts} failed attempt${item.attempts === 1 ? "" : "s"}` : "Waiting"}</span>
                    {item.lastError ? <small>{item.lastError}</small> : null}
                  </div>
                  <Button variant="quiet" disabled={busy} onClick={() => void discardUpload(item.id)}><Trash2 size={15} /> Remove</Button>
                </div>
              ))}
            </div>
          ) : null}
          <div className={styles.pendingActions}>
            <Button variant="secondary" onClick={() => void syncPending()} disabled={busy || !online}>
              <RefreshCw size={16} className={busy ? "spin" : ""} /> Retry sync
            </Button>
          </div>
        </div>
      ) : null}

      {supportMode ? (
        <div className={styles.supportNotice}>
          <FileCheck2 size={18} />
          <div><strong>Founder support · Read only</strong><span>Upload, extraction, review and approval are blocked during the audited support session.</span></div>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Documents" value={String(documents.length)} detail="Workspace supplier files" icon={<FileText size={19} />} />
        <StatCard label="Needs review" value={String(awaitingReview)} detail="Uploaded or extracted drafts" icon={<AlertTriangle size={19} />} />
        <StatCard label="Approved" value={String(approved)} detail="Human-reviewed source records" icon={<PackageCheck size={19} />} />
        <StatCard label="Approved value" value={formatMoney(approvedValue, state.settings.currency)} detail="No Accounts posting yet" icon={<CircleDollarSign size={19} />} />
      </div>

      <Card className={styles.registerCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}>
            <Search size={17} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search supplier, document number or file…" aria-label="Search purchasing documents" />
          </label>
          <div className={styles.filters} aria-label="Purchasing document filters">
            {(["all", "review", "approved", "failed"] as DocumentFilter[]).map((item) => (
              <button key={item} type="button" className={filter === item ? styles.activeFilter : ""} onClick={() => setFilter(item)}>
                {item === "all" ? "All" : item === "review" ? "Needs review" : item === "approved" ? "Approved" : "Scan failed"}
              </button>
            ))}
          </div>
          <Badge tone="neutral">{visibleDocuments.length} documents</Badge>
        </div>

        <div className="table-scroll">
          <table className={styles.documentTable}>
            <thead><tr><th>Document</th><th>Supplier</th><th>Date</th><th>Lines</th><th>Total</th><th>Extraction</th><th>Review</th><th>Inventory</th><th>Accounts</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {visibleDocuments.map((document) => (
                <tr key={document.id}>
                  <td><div className={styles.documentIdentity}><span>{document.document_type === "credit_note" ? <FileCheck2 size={17} /> : <FileText size={17} />}</span><div><strong>{document.document_number || document.file_name}</strong><small>{documentTypeLabel(document.document_type)} · v{document.version}</small></div></div></td>
                  <td><div className={styles.supplierCell}><strong>{document.supplier?.name || document.extracted_supplier_text || "Supplier not matched"}</strong><small>{document.supplier?.code || "Review required"}</small></div></td>
                  <td><div className={styles.statusStack}><strong>{dateLabel(document.document_date)}</strong><small>{document.due_date ? `Due ${dateLabel(document.due_date)}` : "Due date not confirmed"}</small></div></td>
                  <td><div className={styles.statusStack}><strong>{document.line_count}</strong><small>{document.attention_count ? `${document.attention_count} need matching` : "Reviewed structure"}</small></div></td>
                  <td><div className={styles.amountCell}><strong>{formatMoney(Number(document.gross_amount ?? 0), document.currency)}</strong><small>VAT {formatMoney(Number(document.vat_amount ?? 0), document.currency)}</small></div></td>
                  <td><Badge tone={document.extraction_status === "completed" ? "blue" : document.extraction_status === "failed" ? "gold" : "neutral"}>{document.extraction_status}</Badge></td>
                  <td><Badge tone={statusTone(document)}>{statusLabel(document)}</Badge></td>
                  <td><Badge tone="neutral">Not available</Badge></td>
                  <td><Badge tone="neutral">Not available</Badge></td>
                  <td>
                    <div className={styles.rowActions}>
                      {document.status !== "approved" && document.status !== "extracting" ? (
                        <Button variant="quiet" disabled={supportMode || scanningId === document.id || !online} onClick={() => void scanDocument(document.id)}>
                          {scanningId === document.id ? <RefreshCw size={15} className="spin" /> : <ScanLine size={15} />} {document.extraction_status === "completed" ? "Rescan" : "Scan"}
                        </Button>
                      ) : null}
                      <Button variant="quiet" onClick={() => void openDocument(document.id)} disabled={busy}><Eye size={16} /> Review</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleDocuments.length === 0 ? (
          <div className={styles.emptyState}><FileText size={23} /><h3>{documents.length ? "No matching supplier documents" : "No supplier documents yet"}</h3><p>{documents.length ? "Change the search term or filter." : "Upload the first invoice or credit note to begin the controlled review workflow."}</p></div>
        ) : null}
      </Card>

      <div className={styles.lowerGrid}>
        <Card className={styles.guidanceCard}><div className={styles.guidanceIcon}><PackageCheck size={20} /></div><p className="eyebrow">Inventory boundary</p><h2>Approval does not change stock</h2><p className="muted">Inventory receipts and credit-note reversals will be separate ledger commands after the movement ledger is connected.</p></Card>
        <Card className={styles.guidanceCard}><div className={styles.guidanceIcon}><WalletCards size={20} /></div><p className="eyebrow">Accounts boundary</p><h2>Approval does not create a payable</h2><p className="muted">Accounts will later receive approved totals through a controlled posting command. Banking remains responsible for settlement.</p></Card>
      </div>

      <Dialog open={uploadOpen} onClose={() => { if (!busy) setUploadOpen(false); }} title="Upload supplier document" description="Store the original privately, then extract a review draft." className={styles.purchasingDialog}>
        <form onSubmit={uploadDocument}>
          <div className={styles.dialogBody}>
            <div className={styles.stepper} aria-label="Purchasing document progress">
              {["Upload", "Review", "Approve"].map((step, index) => <div key={step} className={index === 0 ? styles.activeStep : ""}><span>{index + 1}</span><strong>{step}</strong></div>)}
            </div>
            <div className={styles.importGrid}>
              <label className={styles.uploadZone}>
                <div className={styles.uploadIcon}><UploadCloud size={28} /></div>
                <h3>Choose or photograph a document</h3>
                <p>Supplier invoice or credit note · PDF, JPG, PNG or WebP · maximum 20 MB</p>
                <input type="file" required accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)} />
                <strong>{selectedFile?.name || "No document selected"}</strong>
                <small>{online ? "The original will be uploaded privately before extraction." : "The file will remain in this browser until connectivity returns."}</small>
              </label>
              <div className={styles.reviewPanel}>
                <div><p className="eyebrow">Controlled workflow</p><h3>Extraction is not approval</h3><p className="muted small">The scanner proposes supplier, dates, totals and lines. A user must confirm all fields and Product matches.</p></div>
                <div className={styles.boundaryNote}><ScanLine size={18} /><div><strong>Cloud-dependent extraction</strong><span>Offline capture is retained locally, but AI extraction starts only after the original file reaches private workspace storage.</span></div></div>
                <div className={styles.boundaryNote}><CheckCircle2 size={18} /><div><strong>Human approval required</strong><span>Approval stores a reviewed source document. Inventory and Accounts remain unchanged.</span></div></div>
              </div>
            </div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setUploadOpen(false)} disabled={busy}>Cancel</Button><Button type="submit" disabled={!selectedFile || busy || supportMode || !cloudMode}>{busy ? <RefreshCw size={16} className="spin" /> : <UploadCloud size={16} />} {online ? "Upload and scan" : "Save for upload"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(review)} onClose={() => { if (!busy) setReview(null); }} title="Review supplier document" description="Confirm the original document, extracted header and every line before approval." className={styles.detailDialog}>
        {review ? (
          <div className={styles.dialogBody}>
            <div className={styles.detailHero}>
              <div><p className="eyebrow">{review.document.file_name}</p><h3>{review.header.documentNumber || "Document number not confirmed"}</h3><p className="muted">{documentTypeLabel(review.header.documentType)} · confidence {review.document.extraction_confidence === null ? "not available" : `${Math.round(Number(review.document.extraction_confidence) * 100)}%`}</p></div>
              <div className={styles.rowActions}>
                {review.originalFileUrl ? <a className={styles.fileLink} href={review.originalFileUrl} target="_blank" rel="noreferrer"><Link2 size={15} /> Open original</a> : <span className={styles.fileUnavailable}><WifiOff size={15} /> Original available online</span>}
                <Badge tone={statusTone(review.document)}>{statusLabel(review.document)}</Badge>
              </div>
            </div>

            {review.document.extraction_notes?.length ? <div className="settings-note" style={{ marginBottom: 16 }}><strong>Extraction notes</strong><p>{review.document.extraction_notes.join(" · ")}</p></div> : null}

            <div className={styles.reviewFormGrid}>
              <label>Supplier<select value={review.header.supplierId} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ supplierId: event.target.value })}><option value="">Select Supplier</option>{review.suppliers.filter((supplier) => supplier.supplier_type === "product").map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name} · {supplier.code}</option>)}</select></label>
              <label>Document type<select value={review.header.documentType} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ documentType: event.target.value as ReviewHeader["documentType"] })}><option value="invoice">Supplier invoice</option><option value="credit_note">Credit note</option><option value="other">Other</option></select></label>
              <label>Document number<input value={review.header.documentNumber} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ documentNumber: event.target.value })} /></label>
              <label>Document date<input type="date" value={review.header.documentDate} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ documentDate: event.target.value })} /></label>
              <label>Due date<input type="date" value={review.header.dueDate} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ dueDate: event.target.value })} /></label>
              <label>Currency<input maxLength={3} value={review.header.currency} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ currency: event.target.value.toUpperCase() })} /></label>
              <label>Subtotal before discount<input type="number" min="0" step="0.01" value={review.header.subtotalBeforeDiscount} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ subtotalBeforeDiscount: event.target.value })} /></label>
              <label>Discount amount<input type="number" min="0" step="0.01" value={review.header.discountAmount} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ discountAmount: event.target.value })} /></label>
              <label>Net after discount<input type="number" min="0" step="0.01" value={review.header.netAfterDiscount} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ netAfterDiscount: event.target.value })} /></label>
              <label>VAT rate %<input type="number" min="0" step="0.01" value={review.header.vatRate} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ vatRate: event.target.value })} /></label>
              <label>VAT amount<input type="number" min="0" step="0.01" value={review.header.vatAmount} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ vatAmount: event.target.value })} /></label>
              <label>Gross amount<input type="number" min="0" step="0.01" value={review.header.grossAmount} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateHeader({ grossAmount: event.target.value })} /></label>
            </div>

            <div className={styles.reviewLinesHeader}>
              <div><p className="eyebrow">Document lines</p><h3>Product and expense matching</h3></div>
              <div className={styles.rowActions}>
                <Badge tone={unresolvedReviewLines || invalidReviewLines ? "gold" : "green"}>{review.lines.length} lines</Badge>
                {review.document.status !== "approved" ? <Button variant="secondary" onClick={addLine} disabled={supportMode || busy}><Plus size={15} /> Add line</Button> : null}
              </div>
            </div>

            <div className={styles.reviewLines}>
              {review.lines.map((line, index) => (
                <div className={styles.reviewLine} key={line.id}>
                  <div className={styles.lineNumber}>{index + 1}</div>
                  <label className={styles.lineDescription}>Printed description<input required value={line.description} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateLine(index, { description: event.target.value })} /></label>
                  <label>Kind<select value={line.lineKind} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateLine(index, { lineKind: event.target.value as ReviewLine["lineKind"] })}><option value="product">Product</option><option value="expense">Non-stock expense</option></select></label>
                  <label>Supplier SKU<input value={line.supplierSku} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateLine(index, { supplierSku: event.target.value })} /></label>
                  <label>Barcode<input value={line.barcode} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateLine(index, { barcode: event.target.value })} /></label>
                  <label>Quantity<input type="number" min="0.0001" step="0.0001" value={line.quantity} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateLine(index, { quantity: event.target.value })} /></label>
                  <label>Unit cost<input type="number" min="0" step="0.0001" value={line.unitCost} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateLine(index, { unitCost: event.target.value })} /></label>
                  <label>RRP<input type="number" min="0" step="0.0001" value={line.rrp} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateLine(index, { rrp: event.target.value })} /></label>
                  <label className={styles.lineProduct}>Matched Product<select value={line.matchedProductId} disabled={supportMode || line.lineKind === "expense" || review.document.status === "approved"} onChange={(event) => updateLine(index, { matchedProductId: event.target.value })}><option value="">Select Product</option>{review.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select><small>{line.lineKind === "expense" ? "This line will not create an Inventory movement." : line.matchedProductSupplierId ? "Product–Supplier relationship matched." : line.matchedProductId ? "Product matched without Supplier terms." : "Match required before approval."}</small></label>
                  <label className={styles.lineNotes}>Review notes<input value={line.notes} disabled={supportMode || review.document.status === "approved"} onChange={(event) => updateLine(index, { notes: event.target.value })} /></label>
                  {review.document.status !== "approved" ? <Button variant="quiet" onClick={() => removeLine(index)} disabled={supportMode || busy}><Trash2 size={15} /> Remove line</Button> : null}
                </div>
              ))}
              {!review.lines.length ? <div className={styles.emptyLines}><FileText size={20} /><strong>No document lines</strong><span>Add the printed lines manually or rescan a clearer document.</span></div> : null}
            </div>

            <div className={styles.postingLockGrid}>
              <div><PackageCheck size={18} /><span><strong>Inventory posting</strong><small>Not available until the movement ledger is connected.</small></span></div>
              <div><WalletCards size={18} /><span><strong>Accounts posting</strong><small>Not available until payable commands are connected.</small></span></div>
            </div>
          </div>
        ) : null}
        <div className="dialog-actions">
          <Button type="button" variant="quiet" onClick={() => setReview(null)} disabled={busy}>Close</Button>
          {review?.document.status !== "approved" ? <Button type="button" variant="quiet" disabled={busy || supportMode || !online} onClick={() => review && void scanDocument(review.document.id)}><ScanLine size={15} /> Rescan</Button> : null}
          {review?.document.status !== "approved" ? <Button type="button" variant="secondary" disabled={busy || supportMode} onClick={() => void saveReview("save_review")}>{online ? "Save review" : "Save locally"}</Button> : null}
          {review?.document.status !== "approved" ? <Button type="button" disabled={!canApprove} title={!canApprove ? "Confirm Supplier, type, number, date, currency and every line before approval" : undefined} onClick={() => void saveReview("approve")}><CheckCircle2 size={16} /> Approve document</Button> : null}
        </div>
      </Dialog>
    </>
  );
}
