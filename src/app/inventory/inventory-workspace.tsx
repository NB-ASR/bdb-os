"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Boxes,
  CheckCircle2,
  CircleDollarSign,
  ClipboardList,
  FileCheck2,
  MapPin,
  PackageCheck,
  PackageMinus,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
  Undo2,
  WifiOff,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import {
  inventoryBalanceFor,
  inventoryStockStatus,
  normaliseInventoryMovementDelta,
  roundInventoryQuantity,
  summariseInventory,
  type InventoryMovementType,
  type InventoryProductSnapshot,
} from "@/lib/modules/inventory";
import {
  failInventoryCommand,
  flushInventoryQueue,
  readInventoryQueue,
  removeInventoryCommand,
  submitInventoryCommand,
  writeInventoryQueue,
  type InventoryCommandAction,
  type InventoryQueuedCommand,
} from "@/lib/modules/inventory-queue";
import { Badge, Button, Card, Dialog, EmptyState, PageHeader, StatCard } from "@/components/ui";
import styles from "./inventory.module.css";

type StockFilter = "all" | "low" | "out" | "archived";
type LocationStatus = "active" | "archived";
type PostingStatus = "ready" | "posted" | "reversed";

type ProductRow = {
  id: string;
  workspace_id?: string;
  sku: string;
  name: string;
  barcode: string | null;
  brand: string | null;
  category: string | null;
  purpose: "resale" | "supply";
  unit_label: string;
  unit_cost: number | string;
  selling_price: number | string | null;
  reorder_level: number | string;
  status: "active" | "archived";
};

type LocationRow = {
  id: string;
  workspace_id?: string;
  code: string;
  name: string;
  is_default: boolean;
  status: LocationStatus;
  version: number;
  pending?: boolean;
};

type BalanceRow = {
  workspace_id?: string;
  product_id: string;
  location_id: string;
  quantity: number | string;
};

type MovementRow = {
  id: string;
  workspace_id?: string;
  product_id: string;
  location_id: string;
  movement_type: InventoryMovementType;
  quantity_delta: number | string;
  unit_cost: number | string | null;
  currency: string | null;
  source_type: string | null;
  source_id: string | null;
  supplier_document_id: string | null;
  supplier_document_line_id: string | null;
  transfer_group_id: string | null;
  reversal_of_id: string | null;
  note: string | null;
  occurred_at: string;
  pending?: boolean;
};

type PurchasingDocument = {
  id: string;
  supplier_id: string | null;
  supplier: { id: string; code: string; name: string } | null;
  document_type: "invoice" | "credit_note";
  document_number: string | null;
  document_date: string | null;
  currency: string;
  inventory_posting_status: PostingStatus;
  inventory_location_id: string | null;
  inventory_posted_at: string | null;
  inventory_reversed_at: string | null;
  file_name: string;
  version: number;
};

type InventoryData = {
  products: ProductRow[];
  locations: LocationRow[];
  balances: BalanceRow[];
  movements: MovementRow[];
  purchasingDocuments: PurchasingDocument[];
};

const emptyData: InventoryData = {
  products: [],
  locations: [],
  balances: [],
  movements: [],
  purchasingDocuments: [],
};

const CACHE_PREFIX = "bdb-inventory-cache-v2";
const LAST_WORKSPACE_KEY = "bdb-inventory-last-workspace-v2";

function cacheKey(workspaceId: string) {
  return `${CACHE_PREFIX}:${workspaceId}`;
}

function numberOf(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function dateTimeLocal() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function readLastWorkspace() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_WORKSPACE_KEY);
}

function readCache(workspaceId: string): InventoryData {
  if (typeof window === "undefined") return emptyData;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as InventoryData | null;
    return parsed && Array.isArray(parsed.products) && Array.isArray(parsed.movements)
      ? parsed
      : emptyData;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return emptyData;
  }
}

function writeCache(workspaceId: string, data: InventoryData) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
  window.localStorage.setItem(cacheKey(workspaceId), JSON.stringify({
    ...data,
    locations: data.locations.map((location) => {
      const cachedLocation = { ...location };
      delete cachedLocation.pending;
      return cachedLocation;
    }),
    movements: data.movements.map((movement) => {
      const cachedMovement = { ...movement };
      delete cachedMovement.pending;
      return cachedMovement;
    }),
  }));
}

function adjustBalance(
  balances: readonly BalanceRow[],
  productId: string,
  locationId: string,
  delta: number,
) {
  const existing = balances.find(
    (balance) => balance.product_id === productId && balance.location_id === locationId,
  );
  if (!existing) {
    return [...balances, {
      product_id: productId,
      location_id: locationId,
      quantity: roundInventoryQuantity(delta),
    }];
  }
  return balances.map((balance) => balance === existing
    ? { ...balance, quantity: roundInventoryQuantity(numberOf(balance.quantity) + delta) }
    : balance);
}

function applyQueuedCommand(data: InventoryData, command: InventoryQueuedCommand): InventoryData {
  const payload = command.payload;
  if (command.action === "create-location") {
    if (data.locations.some((location) => location.id === payload.id)) return data;
    const locations = Boolean(payload.isDefault)
      ? data.locations.map((location) => ({ ...location, is_default: false }))
      : data.locations;
    return {
      ...data,
      locations: [...locations, {
        id: String(payload.id),
        code: String(payload.code),
        name: String(payload.name),
        is_default: Boolean(payload.isDefault),
        status: "active",
        version: 1,
        pending: true,
      }],
    };
  }

  if (["update-location", "archive-location", "restore-location"].includes(command.action)) {
    return {
      ...data,
      locations: data.locations.map((location) => {
        if (location.id !== payload.id) return location;
        if (command.action === "update-location") {
          return {
            ...location,
            code: String(payload.code),
            name: String(payload.name),
            is_default: Boolean(payload.isDefault),
            version: Number(payload.expectedVersion ?? location.version) + 1,
            pending: true,
          };
        }
        return {
          ...location,
          status: command.action === "archive-location" ? "archived" : "active",
          is_default: command.action === "restore-location" ? Boolean(payload.isDefault) : false,
          version: Number(payload.expectedVersion ?? location.version) + 1,
          pending: true,
        };
      }),
    };
  }

  if (command.action === "post-movement") {
    if (data.movements.some((movement) => movement.id === payload.id)) return data;
    const movementType = payload.movementType as InventoryMovementType;
    const delta = normaliseInventoryMovementDelta(movementType, numberOf(payload.quantity));
    const movement: MovementRow = {
      id: String(payload.id),
      product_id: String(payload.productId),
      location_id: String(payload.locationId),
      movement_type: movementType,
      quantity_delta: delta,
      unit_cost: payload.unitCost === "" || payload.unitCost === null ? null : numberOf(payload.unitCost),
      currency: payload.currency ? String(payload.currency) : null,
      source_type: payload.sourceType ? String(payload.sourceType) : null,
      source_id: payload.sourceId ? String(payload.sourceId) : null,
      supplier_document_id: null,
      supplier_document_line_id: null,
      transfer_group_id: null,
      reversal_of_id: null,
      note: payload.note ? String(payload.note) : null,
      occurred_at: String(payload.occurredAt),
      pending: true,
    };
    return {
      ...data,
      movements: [movement, ...data.movements],
      balances: adjustBalance(data.balances, movement.product_id, movement.location_id, delta),
    };
  }

  if (command.action === "transfer-stock") {
    if (data.movements.some((movement) => movement.transfer_group_id === payload.transferGroupId)) return data;
    const quantity = Math.abs(numberOf(payload.quantity));
    const common = {
      product_id: String(payload.productId),
      unit_cost: null,
      currency: null,
      source_type: null,
      source_id: null,
      supplier_document_id: null,
      supplier_document_line_id: null,
      reversal_of_id: null,
      transfer_group_id: String(payload.transferGroupId),
      note: payload.note ? String(payload.note) : null,
      occurred_at: String(payload.occurredAt),
      pending: true,
    };
    const outbound: MovementRow = {
      ...common,
      id: String(payload.outMovementId),
      location_id: String(payload.fromLocationId),
      movement_type: "transfer_out",
      quantity_delta: -quantity,
    };
    const inbound: MovementRow = {
      ...common,
      id: String(payload.inMovementId),
      location_id: String(payload.toLocationId),
      movement_type: "transfer_in",
      quantity_delta: quantity,
    };
    return {
      ...data,
      movements: [inbound, outbound, ...data.movements],
      balances: adjustBalance(
        adjustBalance(data.balances, common.product_id, outbound.location_id, -quantity),
        common.product_id,
        inbound.location_id,
        quantity,
      ),
    };
  }

  if (command.action === "reverse-movement") {
    if (data.movements.some((movement) => movement.id === payload.id)) return data;
    const original = data.movements.find((movement) => movement.id === payload.reversalOfId);
    if (!original) return data;
    const reversal: MovementRow = {
      ...original,
      id: String(payload.id),
      movement_type: "reversal",
      quantity_delta: -numberOf(original.quantity_delta),
      source_type: "inventory_reversal",
      source_id: original.id,
      reversal_of_id: original.id,
      note: payload.note ? String(payload.note) : null,
      occurred_at: String(payload.occurredAt),
      pending: true,
    };
    return {
      ...data,
      movements: [reversal, ...data.movements],
      balances: adjustBalance(
        data.balances,
        reversal.product_id,
        reversal.location_id,
        numberOf(reversal.quantity_delta),
      ),
    };
  }

  return data;
}

function movementLabel(type: InventoryMovementType) {
  const labels: Record<InventoryMovementType, string> = {
    opening_balance: "Opening balance",
    purchase_receipt: "Supplier receipt",
    sale: "Sale",
    appointment_consumption: "Appointment consumption",
    internal_consumption: "Internal consumption",
    customer_return: "Customer return",
    supplier_return: "Supplier return",
    transfer_out: "Transfer out",
    transfer_in: "Transfer in",
    manual_adjustment: "Manual adjustment",
    stocktake_correction: "Stocktake correction",
    write_off: "Write-off",
    reversal: "Reversal",
  };
  return labels[type];
}

function postingLabel(status: PostingStatus) {
  if (status === "ready") return "Ready to post";
  if (status === "posted") return "Posted";
  return "Reversed";
}

export default function InventoryWorkspace() {
  const { state, mode } = useBdb();
  const [data, setData] = useState<InventoryData>(emptyData);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StockFilter>("all");
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [locationOpen, setLocationOpen] = useState(false);
  const [editingLocation, setEditingLocation] = useState<LocationRow | null>(null);
  const [locationForm, setLocationForm] = useState({ code: "MAIN", name: "Main stock", isDefault: true });
  const [movementOpen, setMovementOpen] = useState(false);
  const [movementForm, setMovementForm] = useState({
    productId: "",
    locationId: "",
    destinationLocationId: "",
    movementType: "opening_balance" as InventoryMovementType | "transfer",
    quantity: "",
    occurredAt: dateTimeLocal(),
    note: "",
  });
  const [postingOpen, setPostingOpen] = useState(false);
  const [postingDocumentId, setPostingDocumentId] = useState("");
  const [postingLocationId, setPostingLocationId] = useState("");
  const [reversalDocument, setReversalDocument] = useState<PurchasingDocument | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const syncInFlight = useRef(false);
  const supportMode = false;
  const cloudMode = mode === "cloud";

  const currency = useMemo(
    () => new Intl.NumberFormat("en-GB", { style: "currency", currency: state.settings.currency }),
    [state.settings.currency],
  );

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

  const loadCloud = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }
    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    const response = await fetch(`/api/inventory?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, {
      cache: "no-store",
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Inventory could not be loaded.");
    const cloud = result.result as InventoryData;
    const normalized: InventoryData = {
      products: cloud.products ?? [],
      locations: cloud.locations ?? [],
      balances: cloud.balances ?? [],
      movements: cloud.movements ?? [],
      purchasingDocuments: cloud.purchasingDocuments ?? [],
    };
    writeCache(currentWorkspaceId, normalized);
    const queue = readInventoryQueue(currentWorkspaceId);
    setData(queue.reduce(applyQueuedCommand, normalized));
    setPendingCount(queue.length);
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastWorkspace();
      const cached = fallbackWorkspace ? readCache(fallbackWorkspace) : emptyData;
      const queue = fallbackWorkspace ? readInventoryQueue(fallbackWorkspace) : [];
      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        setData(queue.reduce(applyQueuedCommand, cached));
        setPendingCount(queue.length);
      }
      try {
        setError("");
        if (mode === "demo") return;
        if (!navigator.onLine) {
          if (cached.products.length || queue.length) {
            setNotice("Showing cached Inventory. New movements will remain queued until the connection returns.");
          } else {
            setError("Inventory needs one successful online load before this workspace can open offline.");
          }
          return;
        }
        await loadCloud();
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : "Inventory could not be loaded.");
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [loadCloud, mode]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || !online || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setError("");
    try {
      const result = await flushInventoryQueue(workspaceId, setPendingCount);
      if (result.completed) {
        setNotice(`${result.completed} queued Inventory change${result.completed === 1 ? "" : "s"} synced.`);
      }
      await loadCloud();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Inventory could not be synchronized.");
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [loadCloud, online, workspaceId]);

  useEffect(() => {
    if (!cloudMode || !online || !pendingCount) return;
    void syncPending();
  }, [cloudMode, online, pendingCount, syncPending]);

  const submitCommand = useCallback(async (
    action: InventoryCommandAction,
    payload: Record<string, unknown>,
  ) => {
    if (!workspaceId || supportMode) return false;
    setError("");
    setNotice("");
    const command: InventoryQueuedCommand = {
      id: crypto.randomUUID(),
      workspaceId,
      action,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };
    setData((current) => applyQueuedCommand(current, command));

    if (mode === "demo") {
      const next = readInventoryQueue(workspaceId);
      writeInventoryQueue(workspaceId, [...next, command]);
      setPendingCount(next.length + 1);
      setNotice("Saved in this browser-only preview.");
      return true;
    }

    writeInventoryQueue(workspaceId, [...readInventoryQueue(workspaceId), command]);
    setPendingCount(readInventoryQueue(workspaceId).length);
    if (!online) {
      setNotice("Inventory change queued. It will sync after reconnection.");
      return true;
    }

    try {
      await submitInventoryCommand(command);
      removeInventoryCommand(workspaceId, command.id);
      setPendingCount(readInventoryQueue(workspaceId).length);
      await loadCloud();
      return true;
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Inventory change failed.";
      failInventoryCommand(workspaceId, command.id, message);
      setPendingCount(readInventoryQueue(workspaceId).length);
      setError(message);
      return false;
    }
  }, [loadCloud, mode, online, supportMode, workspaceId]);

  const activeLocations = data.locations.filter((location) => location.status === "active");
  const defaultLocation = activeLocations.find((location) => location.is_default) ?? activeLocations[0] ?? null;
  const balanceSnapshots = data.balances.map((balance) => ({
    productId: balance.product_id,
    locationId: balance.location_id,
    quantity: numberOf(balance.quantity),
  }));
  const productSnapshots: InventoryProductSnapshot[] = data.products.map((product) => ({
    id: product.id,
    name: product.name,
    sku: product.sku,
    purpose: product.purpose,
    quantity: inventoryBalanceFor(balanceSnapshots, product.id),
    reorderLevel: numberOf(product.reorder_level),
    unitCost: numberOf(product.unit_cost),
    sellingPrice: product.selling_price === null ? null : numberOf(product.selling_price),
    status: product.status,
  }));
  const summary = summariseInventory(productSnapshots);
  const productMap = useMemo(
    () => new Map(data.products.map((product) => [product.id, product])),
    [data.products],
  );
  const locationMap = new Map(data.locations.map((location) => [location.id, location]));
  const reversedMovementIds = new Set(
    data.movements.map((movement) => movement.reversal_of_id).filter(Boolean) as string[],
  );

  const visibleProducts = useMemo(() => {
    const term = query.trim().toLowerCase();
    return productSnapshots.filter((snapshot) => {
      const product = productMap.get(snapshot.id);
      const stockStatus = inventoryStockStatus(snapshot);
      const matchesSearch = !term || [
        product?.name,
        product?.sku,
        product?.category,
        product?.brand,
        product?.barcode,
      ].join(" ").toLowerCase().includes(term);
      const matchesFilter = filter === "all"
        ? product?.status === "active"
        : filter === "archived"
          ? product?.status === "archived"
          : filter === "low"
            ? product?.status === "active" && stockStatus === "low-stock"
            : product?.status === "active" && stockStatus === "out-of-stock";
      return matchesSearch && matchesFilter;
    });
  }, [filter, productMap, productSnapshots, query]);

  function openCreateLocation() {
    setEditingLocation(null);
    setLocationForm({
      code: data.locations.length ? "STORE" : "MAIN",
      name: data.locations.length ? "Stock location" : "Main stock",
      isDefault: !activeLocations.length,
    });
    setLocationOpen(true);
  }

  function openEditLocation(location: LocationRow) {
    setEditingLocation(location);
    setLocationForm({ code: location.code, name: location.name, isDefault: location.is_default });
    setLocationOpen(true);
  }

  async function saveLocation(event: FormEvent) {
    event.preventDefault();
    if (busy || supportMode) return;
    setBusy(true);
    const payload = editingLocation
      ? {
          id: editingLocation.id,
          code: locationForm.code,
          name: locationForm.name,
          isDefault: locationForm.isDefault,
          expectedVersion: editingLocation.version,
        }
      : {
          id: crypto.randomUUID(),
          code: locationForm.code,
          name: locationForm.name,
          isDefault: locationForm.isDefault,
        };
    const saved = await submitCommand(editingLocation ? "update-location" : "create-location", payload);
    if (saved) setLocationOpen(false);
    setBusy(false);
  }

  async function changeLocationStatus(location: LocationRow) {
    if (busy || supportMode) return;
    setBusy(true);
    await submitCommand(location.status === "active" ? "archive-location" : "restore-location", {
      id: location.id,
      expectedVersion: location.version,
      isDefault: false,
    });
    setBusy(false);
  }

  function openMovement(productId = "") {
    setMovementForm({
      productId,
      locationId: defaultLocation?.id ?? "",
      destinationLocationId: "",
      movementType: "opening_balance",
      quantity: "",
      occurredAt: dateTimeLocal(),
      note: "",
    });
    setMovementOpen(true);
  }

  async function saveMovement(event: FormEvent) {
    event.preventDefault();
    if (busy || supportMode) return;
    setBusy(true);
    const isTransfer = movementForm.movementType === "transfer";
    const saved = isTransfer
      ? await submitCommand("transfer-stock", {
          outMovementId: crypto.randomUUID(),
          inMovementId: crypto.randomUUID(),
          transferGroupId: crypto.randomUUID(),
          productId: movementForm.productId,
          fromLocationId: movementForm.locationId,
          toLocationId: movementForm.destinationLocationId,
          quantity: movementForm.quantity,
          occurredAt: new Date(movementForm.occurredAt).toISOString(),
          note: movementForm.note,
        })
      : await submitCommand("post-movement", {
          id: crypto.randomUUID(),
          productId: movementForm.productId,
          locationId: movementForm.locationId,
          movementType: movementForm.movementType,
          quantity: movementForm.quantity,
          occurredAt: new Date(movementForm.occurredAt).toISOString(),
          note: movementForm.note,
          unitCost: productMap.get(movementForm.productId)?.unit_cost ?? null,
          currency: state.settings.currency,
        });
    if (saved) setMovementOpen(false);
    setBusy(false);
  }

  async function reverseMovement(movement: MovementRow) {
    if (busy || supportMode || movement.pending) return;
    setBusy(true);
    await submitCommand("reverse-movement", {
      id: crypto.randomUUID(),
      productId: movement.product_id,
      locationId: movement.location_id,
      reversalOfId: movement.id,
      occurredAt: new Date().toISOString(),
      note: `Correction of ${movementLabel(movement.movement_type)}`,
    });
    setBusy(false);
  }

  function openPosting(documentId = "") {
    setPostingDocumentId(documentId || data.purchasingDocuments.find((document) => document.inventory_posting_status === "ready")?.id || "");
    setPostingLocationId(defaultLocation?.id ?? "");
    setPostingOpen(true);
  }

  async function postDocument(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || workspaceId === "demo" || supportMode || busy || !online) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          workspaceId,
          action: "post-purchasing-document",
          documentId: postingDocumentId,
          locationId: postingLocationId,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The supplier document could not be posted.");
      setPostingOpen(false);
      setNotice("The approved supplier document was posted to the immutable Inventory ledger.");
      await loadCloud();
    } catch (postingError) {
      setError(postingError instanceof Error ? postingError.message : "The supplier document could not be posted.");
    } finally {
      setBusy(false);
    }
  }

  async function reverseDocumentPosting(event: FormEvent) {
    event.preventDefault();
    if (!workspaceId || !reversalDocument || supportMode || busy || !online) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/inventory", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({
          workspaceId,
          action: "reverse-purchasing-document",
          documentId: reversalDocument.id,
          reason: reversalReason,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The document posting could not be reversed.");
      setReversalDocument(null);
      setReversalReason("");
      setNotice("The complete supplier-document Inventory posting was reversed with an audit reason.");
      await loadCloud();
    } catch (reversalError) {
      setError(reversalError instanceof Error ? reversalError.message : "The document posting could not be reversed.");
    } finally {
      setBusy(false);
    }
  }

  function discardQueuedCommand(commandId: string) {
    if (!workspaceId || busy) return;
    removeInventoryCommand(workspaceId, commandId);
    setPendingCount(readInventoryQueue(workspaceId).length);
    const cached = readCache(workspaceId);
    setData(readInventoryQueue(workspaceId).reduce(applyQueuedCommand, cached));
    setNotice("The local queued Inventory change was discarded. Shared records were not changed.");
  }

  if (!loaded) {
    return <main className="admin-loading"><RefreshCw size={20} className="spin" /> Loading Inventory…</main>;
  }

  return (
    <>
      <PageHeader
        eyebrow="Stock control"
        title="Inventory"
        description="Current stock is derived from immutable Product movements across workspace locations."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={openCreateLocation} disabled={supportMode}>
              <MapPin size={17} /> Manage location
            </Button>
            <Button variant="secondary" onClick={() => openMovement()} disabled={supportMode || !activeLocations.length || !data.products.some((product) => product.status === "active")}>
              <Plus size={17} /> Record movement
            </Button>
            <Button onClick={() => openPosting()} disabled={supportMode || !online || !data.purchasingDocuments.some((document) => document.inventory_posting_status === "ready") || !activeLocations.length}>
              <FileCheck2 size={17} /> Post approved document
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <ClipboardList size={19} />
        <div>
          <strong>Append-only stock ledger</strong>
          <p>Products define what an item is. Inventory records why quantity changed. Posted movements are corrected through reversals, never edits.</p>
        </div>
      </div>

      {!online ? <div className={styles.offlineNotice}><WifiOff size={18} /><div><strong>Working offline</strong><span>Manual movements and location changes remain queued. Purchasing posting requires current cloud validation.</span></div></div> : null}
      {supportMode ? <div className={styles.supportNotice}><FileCheck2 size={18} /><div><strong>Read-only access</strong><span>Inventory commands and Purchasing posting are blocked during this session.</span></div></div> : null}
      {error ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Inventory needs attention</strong><p>{error}</p></div></div> : null}
      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Inventory updated</strong><p>{notice}</p></div> : null}

      {pendingCount && workspaceId ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong>{pendingCount} Inventory change{pendingCount === 1 ? "" : "s"} waiting to sync</strong>
          <p>Commands retain stable idempotency keys. Synchronisation stops on the first validation or conflict error.</p>
          <div className={styles.pendingList}>
            {readInventoryQueue(workspaceId).map((command) => (
              <div className={styles.pendingItem} key={command.id}>
                <div><strong>{command.action.replaceAll("-", " ")}</strong><span>{command.lastError || (command.attempts ? `${command.attempts} failed attempt${command.attempts === 1 ? "" : "s"}` : "Waiting")}</span></div>
                <Button variant="quiet" onClick={() => discardQueuedCommand(command.id)} disabled={busy}><Trash2 size={15} /> Discard</Button>
              </div>
            ))}
          </div>
          <Button variant="secondary" onClick={() => void syncPending()} disabled={!online || syncing}>
            <RefreshCw size={16} className={syncing ? "spin" : ""} /> Retry sync
          </Button>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Products tracked" value={String(summary.activeProductCount)} detail={`${summary.totalUnits} total units`} icon={<Boxes size={19} />} />
        <StatCard label="Low stock" value={String(summary.lowStockProductCount)} detail="At or below reorder level" icon={<AlertTriangle size={19} />} />
        <StatCard label="Out of stock" value={String(summary.outOfStockProductCount)} detail="Includes negative balances" icon={<PackageMinus size={19} />} />
        <StatCard label="Catalogue cost value" value={currency.format(summary.catalogueCostValue)} detail="Current quantity × Product cost" icon={<CircleDollarSign size={19} />} />
      </div>

      <Card className={styles.inventoryCard}>
        <div className={styles.toolbar}>
          <label className={styles.searchField}><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, SKU, category, brand or barcode…" aria-label="Search inventory" /></label>
          <div className={styles.filters} aria-label="Inventory filters">
            {(["all", "low", "out", "archived"] as StockFilter[]).map((item) => (
              <button key={item} type="button" className={filter === item ? styles.activeFilter : ""} onClick={() => setFilter(item)}>
                {item === "all" ? "All stock" : item === "low" ? "Low stock" : item === "out" ? "Out of stock" : "Archived"}
              </button>
            ))}
          </div>
          <Badge tone="neutral">{visibleProducts.length} Products</Badge>
        </div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Product</th><th>SKU</th><th>Purpose</th><th>Category</th><th>On hand</th><th>Reorder at</th><th>Status</th><th>Value</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {visibleProducts.map((snapshot) => {
                const product = productMap.get(snapshot.id)!;
                const stockStatus = inventoryStockStatus(snapshot);
                const negative = snapshot.quantity < 0;
                return (
                  <tr key={product.id}>
                    <td><div className={styles.productIdentity}><strong>{product.name}</strong><small>{product.brand || "No brand"} · {product.unit_label}</small></div></td>
                    <td>{product.sku}</td>
                    <td><Badge tone={product.purpose === "resale" ? "blue" : "neutral"}>{product.purpose === "resale" ? "Resale" : "Business supply"}</Badge></td>
                    <td>{product.category || "Uncategorised"}</td>
                    <td><strong className={negative ? styles.negative : ""}>{snapshot.quantity}</strong></td>
                    <td>{snapshot.reorderLevel}</td>
                    <td><Badge tone={stockStatus === "in-stock" ? "green" : stockStatus === "low-stock" ? "gold" : "neutral"}>{negative ? "Correction required" : stockStatus.replaceAll("-", " ")}</Badge></td>
                    <td>{currency.format(snapshot.quantity * snapshot.unitCost)}</td>
                    <td><Button variant="quiet" onClick={() => openMovement(product.id)} disabled={supportMode || product.status === "archived" || !activeLocations.length}><Plus size={15} /> Movement</Button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!visibleProducts.length ? <EmptyState icon={<PackageCheck size={24} />} title={data.products.length ? "No matching Inventory Products" : "No Products to track"} description={data.products.length ? "Change the search or stock filter." : "Create Products in the shared catalogue before recording stock movements."} /> : null}
      </Card>

      <div className={styles.operationalGrid}>
        <Card className={styles.panelCard}>
          <div className={styles.panelHeader}><div><p className="eyebrow">Stock locations</p><h2>Where stock is held</h2></div><Button variant="quiet" onClick={openCreateLocation} disabled={supportMode}><Plus size={15} /> Add</Button></div>
          <div className={styles.locationList}>
            {data.locations.map((location) => (
              <div className={styles.locationItem} key={location.id}>
                <div><strong>{location.name}</strong><span>{location.code} · {location.is_default ? "Default" : location.status}</span></div>
                <div className={styles.rowActions}>
                  <Badge tone={location.status === "active" ? "green" : "neutral"}>{location.status}</Badge>
                  <Button variant="quiet" onClick={() => openEditLocation(location)} disabled={supportMode || location.status === "archived"}>Edit</Button>
                  <Button variant="quiet" onClick={() => void changeLocationStatus(location)} disabled={supportMode || busy}>{location.status === "active" ? "Archive" : "Restore"}</Button>
                </div>
              </div>
            ))}
            {!data.locations.length ? <p className="muted small">Create the first stock location before recording movements or posting Purchasing documents.</p> : null}
          </div>
        </Card>

        <Card className={styles.panelCard}>
          <div className={styles.panelHeader}><div><p className="eyebrow">Purchasing queue</p><h2>Approved documents</h2></div><Badge tone="neutral">{data.purchasingDocuments.filter((document) => document.inventory_posting_status === "ready").length} ready</Badge></div>
          <div className={styles.documentList}>
            {data.purchasingDocuments.map((document) => (
              <div className={styles.documentItem} key={document.id}>
                <div><strong>{document.document_number || document.file_name}</strong><span>{document.supplier?.name || "Supplier"} · {document.document_type === "credit_note" ? "Credit note" : "Invoice"}</span></div>
                <div className={styles.rowActions}>
                  <Badge tone={document.inventory_posting_status === "posted" ? "green" : document.inventory_posting_status === "ready" ? "gold" : "neutral"}>{postingLabel(document.inventory_posting_status)}</Badge>
                  {document.inventory_posting_status === "ready" ? <Button variant="quiet" onClick={() => openPosting(document.id)} disabled={supportMode || !online || !activeLocations.length}>Post</Button> : null}
                  {document.inventory_posting_status === "posted" ? <Button variant="quiet" onClick={() => { setReversalDocument(document); setReversalReason(""); }} disabled={supportMode || !online}>Reverse</Button> : null}
                </div>
              </div>
            ))}
            {!data.purchasingDocuments.length ? <p className="muted small">Approved supplier invoices and credit notes will appear here when ready for Inventory posting.</p> : null}
          </div>
        </Card>
      </div>

      <Card className={styles.movementCard}>
        <div className={styles.panelHeader}><div><p className="eyebrow">Immutable history</p><h2>Recent movements</h2></div><Badge tone="neutral">{data.movements.length} loaded</Badge></div>
        <div className="table-scroll">
          <table>
            <thead><tr><th>Date</th><th>Product</th><th>Location</th><th>Movement</th><th>Quantity</th><th>Source</th><th>Note</th><th aria-label="Actions" /></tr></thead>
            <tbody>
              {data.movements.map((movement) => {
                const reversible = !movement.pending
                  && movement.movement_type !== "reversal"
                  && !movement.transfer_group_id
                  && !movement.supplier_document_id
                  && !reversedMovementIds.has(movement.id);
                return (
                  <tr key={movement.id}>
                    <td>{new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(movement.occurred_at))}</td>
                    <td>{productMap.get(movement.product_id)?.name || "Product"}</td>
                    <td>{locationMap.get(movement.location_id)?.name || "Location"}</td>
                    <td><Badge tone={numberOf(movement.quantity_delta) < 0 ? "gold" : "green"}>{movementLabel(movement.movement_type)}</Badge></td>
                    <td><strong className={numberOf(movement.quantity_delta) < 0 ? styles.negative : styles.positive}>{numberOf(movement.quantity_delta) > 0 ? "+" : ""}{numberOf(movement.quantity_delta)}</strong></td>
                    <td>{movement.supplier_document_id ? "Purchasing document" : movement.source_type?.replaceAll("_", " ") || "Manual"}</td>
                    <td>{movement.note || "—"}</td>
                    <td>{reversible ? <Button variant="quiet" onClick={() => void reverseMovement(movement)} disabled={supportMode || busy}><Undo2 size={15} /> Reverse</Button> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!data.movements.length ? <EmptyState icon={<ClipboardList size={24} />} title="No Inventory movements yet" description="Create an opening balance, manual adjustment or post an approved Purchasing document." /> : null}
      </Card>

      <Dialog open={locationOpen} onClose={() => { if (!busy) setLocationOpen(false); }} title={editingLocation ? "Edit stock location" : "Create stock location"} description="Locations separate stock physically or operationally without duplicating Products." className={styles.inventoryDialog}>
        <form onSubmit={saveLocation}>
          <div className={styles.dialogBody}><div className={styles.formGrid}><label>Location code<input required maxLength={32} value={locationForm.code} onChange={(event) => setLocationForm((current) => ({ ...current, code: event.target.value }))} /></label><label>Location name<input required maxLength={120} value={locationForm.name} onChange={(event) => setLocationForm((current) => ({ ...current, name: event.target.value }))} /></label><label className={styles.checkboxLabel}><input type="checkbox" checked={locationForm.isDefault} onChange={(event) => setLocationForm((current) => ({ ...current, isDefault: event.target.checked }))} /> Default posting location</label></div></div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setLocationOpen(false)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || supportMode}>{busy ? <RefreshCw size={16} className="spin" /> : <MapPin size={16} />} Save location</Button></div>
        </form>
      </Dialog>

      <Dialog open={movementOpen} onClose={() => { if (!busy) setMovementOpen(false); }} title="Record Inventory movement" description="Record an auditable quantity change. Purchasing, Sales and Appointments post from their own records." className={styles.inventoryDialog}>
        <form onSubmit={saveMovement}>
          <div className={styles.dialogBody}><div className={styles.formGrid}>
            <label>Product<select required value={movementForm.productId} onChange={(event) => setMovementForm((current) => ({ ...current, productId: event.target.value }))}><option value="">Select Product</option>{data.products.filter((product) => product.status === "active").map((product) => <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>)}</select></label>
            <label>Movement type<select value={movementForm.movementType} onChange={(event) => setMovementForm((current) => ({ ...current, movementType: event.target.value as InventoryMovementType | "transfer" }))}><option value="opening_balance">Opening balance</option><option value="manual_adjustment">Manual adjustment</option><option value="stocktake_correction">Stocktake correction</option><option value="internal_consumption">Internal consumption</option><option value="write_off">Write-off</option><option value="customer_return">Customer return</option><option value="transfer">Transfer between locations</option></select></label>
            <label>{movementForm.movementType === "transfer" ? "From location" : "Location"}<select required value={movementForm.locationId} onChange={(event) => setMovementForm((current) => ({ ...current, locationId: event.target.value }))}><option value="">Select location</option>{activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.is_default ? " · Default" : ""}</option>)}</select></label>
            {movementForm.movementType === "transfer" ? <label>To location<select required value={movementForm.destinationLocationId} onChange={(event) => setMovementForm((current) => ({ ...current, destinationLocationId: event.target.value }))}><option value="">Select destination</option>{activeLocations.filter((location) => location.id !== movementForm.locationId).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label> : null}
            <label>Quantity<input required type="number" step="0.001" value={movementForm.quantity} onChange={(event) => setMovementForm((current) => ({ ...current, quantity: event.target.value }))} placeholder={movementForm.movementType === "manual_adjustment" || movementForm.movementType === "stocktake_correction" ? "Positive or negative" : "Positive quantity"} /></label>
            <label>Occurred at<input required type="datetime-local" value={movementForm.occurredAt} onChange={(event) => setMovementForm((current) => ({ ...current, occurredAt: event.target.value }))} /></label>
            <label className={styles.fullField}>Reason or note<textarea maxLength={500} value={movementForm.note} onChange={(event) => setMovementForm((current) => ({ ...current, note: event.target.value }))} placeholder="Explain manual corrections and write-offs." /></label>
          </div></div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setMovementOpen(false)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || supportMode || !movementForm.productId || !movementForm.locationId || !movementForm.quantity || (movementForm.movementType === "transfer" && !movementForm.destinationLocationId)}>{busy ? <RefreshCw size={16} className="spin" /> : movementForm.movementType === "transfer" ? <ArrowLeftRight size={16} /> : <Plus size={16} />} Record movement</Button></div>
        </form>
      </Dialog>

      <Dialog open={postingOpen} onClose={() => { if (!busy) setPostingOpen(false); }} title="Post approved Purchasing document" description="Create one immutable movement for every reviewed Product line." className={styles.inventoryDialog}>
        <form onSubmit={postDocument}>
          <div className={styles.dialogBody}><div className={styles.formGrid}><label>Approved document<select required value={postingDocumentId} onChange={(event) => setPostingDocumentId(event.target.value)}><option value="">Select document</option>{data.purchasingDocuments.filter((document) => document.inventory_posting_status === "ready").map((document) => <option key={document.id} value={document.id}>{document.document_number || document.file_name} · {document.supplier?.name || "Supplier"}</option>)}</select></label><label>Stock location<select required value={postingLocationId} onChange={(event) => setPostingLocationId(event.target.value)}><option value="">Select location</option>{activeLocations.map((location) => <option key={location.id} value={location.id}>{location.name}{location.is_default ? " · Default" : ""}</option>)}</select></label></div><div className={styles.boundaryNote}><CheckCircle2 size={18} /><div><strong>Atomic posting</strong><span>Every Product line posts together or none post. Repeating the command cannot duplicate stock.</span></div></div></div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setPostingOpen(false)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || supportMode || !online || !postingDocumentId || !postingLocationId}>{busy ? <RefreshCw size={16} className="spin" /> : <PackageCheck size={16} />} Post to Inventory</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(reversalDocument)} onClose={() => { if (!busy) setReversalDocument(null); }} title="Reverse supplier-document posting" description="Reverse every movement created by this document. The approved source document remains preserved." className={styles.inventoryDialog}>
        <form onSubmit={reverseDocumentPosting}>
          <div className={styles.dialogBody}><div className={styles.warningPanel}><RotateCcw size={20} /><div><strong>{reversalDocument?.document_number || reversalDocument?.file_name}</strong><span>This action creates opposite movements; it does not delete history.</span></div></div><label className={styles.reasonField}>Audit reason<textarea required minLength={5} maxLength={500} value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} placeholder="Explain why the complete posting is being reversed." /></label></div>
          <div className="dialog-actions"><Button type="button" variant="quiet" onClick={() => setReversalDocument(null)} disabled={busy}>Cancel</Button><Button type="submit" variant="secondary" disabled={busy || supportMode || !online || reversalReason.trim().length < 5}>{busy ? <RefreshCw size={16} className="spin" /> : <RotateCcw size={16} />} Reverse posting</Button></div>
        </form>
      </Dialog>
    </>
  );
}
