"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  Boxes,
  CircleDollarSign,
  MapPin,
  Plus,
  RefreshCw,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { formatMoney, formatTimeAgo } from "@/lib/format";
import {
  inventoryStockStatus,
  normaliseInventoryMovementDelta,
  suggestedReorderQuantity,
  summariseInventory,
  type InventoryItemPurpose,
  type InventoryMovementType,
} from "@/lib/modules/inventory";
import {
  enqueueInventoryCommand,
  failInventoryCommand,
  flushInventoryQueue,
  readInventoryQueue,
  removeInventoryCommand,
  submitInventoryCommand,
  writeInventoryQueue,
  type InventoryCommandAction,
  type InventoryQueuedCommand,
} from "@/lib/modules/inventory-queue";
import { Badge, Button, Card, Dialog, EmptyState, PageHeader, SectionHeading, StatCard } from "@/components/ui";

const DEMO_STORAGE_KEY = "bdb-inventory-demo-v1";

type InventoryItemRow = {
  id: string;
  workspace_id?: string;
  sku: string;
  name: string;
  purpose: InventoryItemPurpose;
  unit_label: string;
  reorder_point: number;
  target_quantity: number;
  unit_cost: number;
  unit_price: number | null;
  active: boolean;
  pending?: boolean;
};

type InventoryLocationRow = {
  id: string;
  workspace_id?: string;
  code: string;
  name: string;
  is_default: boolean;
  active: boolean;
  pending?: boolean;
};

type InventoryBalanceRow = {
  workspace_id?: string;
  item_id: string;
  location_id: string;
  quantity: number;
};

type InventoryMovementRow = {
  id: string;
  workspace_id?: string;
  item_id: string;
  location_id: string;
  movement_type: InventoryMovementType;
  quantity_delta: number;
  occurred_at: string;
  note?: string | null;
  reversal_of_id?: string | null;
  transfer_group_id?: string | null;
  pending?: boolean;
};

type InventoryData = {
  items: InventoryItemRow[];
  locations: InventoryLocationRow[];
  balances: InventoryBalanceRow[];
  movements: InventoryMovementRow[];
};

const emptyInventory: InventoryData = {
  items: [],
  locations: [],
  balances: [],
  movements: [],
};

function quantity(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 1000) / 1000 : 0;
}

function adjustBalance(
  balances: readonly InventoryBalanceRow[],
  itemId: string,
  locationId: string,
  delta: number,
) {
  const existing = balances.find((balance) => balance.item_id === itemId && balance.location_id === locationId);
  if (!existing) {
    return [...balances, { item_id: itemId, location_id: locationId, quantity: quantity(delta) }];
  }
  return balances.map((balance) => balance === existing
    ? { ...balance, quantity: quantity(balance.quantity + delta) }
    : balance);
}

function applyCommand(data: InventoryData, command: InventoryQueuedCommand): InventoryData {
  const payload = command.payload;

  if (command.action === "create-location") {
    if (data.locations.some((location) => location.id === payload.id)) return data;
    const nextLocations = payload.isDefault
      ? data.locations.map((location) => ({ ...location, is_default: false }))
      : data.locations;
    return {
      ...data,
      locations: [...nextLocations, {
        id: String(payload.id),
        code: String(payload.code),
        name: String(payload.name),
        is_default: Boolean(payload.isDefault),
        active: true,
        pending: true,
      }],
    };
  }

  if (command.action === "create-item") {
    if (data.items.some((item) => item.id === payload.id)) return data;
    return {
      ...data,
      items: [...data.items, {
        id: String(payload.id),
        sku: String(payload.sku),
        name: String(payload.name),
        purpose: payload.purpose as InventoryItemPurpose,
        unit_label: String(payload.unitLabel ?? "unit"),
        reorder_point: quantity(payload.reorderPoint),
        target_quantity: quantity(payload.targetQuantity),
        unit_cost: Number(payload.unitCost ?? 0),
        unit_price: payload.unitPrice === null || payload.unitPrice === "" ? null : Number(payload.unitPrice ?? 0),
        active: true,
        pending: true,
      }],
    };
  }

  if (command.action === "post-movement") {
    if (data.movements.some((movement) => movement.id === payload.id)) return data;
    const movementType = payload.movementType as InventoryMovementType;
    const delta = normaliseInventoryMovementDelta(movementType, Number(payload.quantity));
    const movement: InventoryMovementRow = {
      id: String(payload.id),
      item_id: String(payload.itemId),
      location_id: String(payload.locationId),
      movement_type: movementType,
      quantity_delta: delta,
      occurred_at: String(payload.occurredAt),
      note: payload.note ? String(payload.note) : null,
      pending: true,
    };
    return {
      ...data,
      movements: [movement, ...data.movements],
      balances: adjustBalance(data.balances, movement.item_id, movement.location_id, delta),
    };
  }

  if (command.action === "transfer-stock") {
    if (data.movements.some((movement) => movement.transfer_group_id === payload.transferGroupId)) return data;
    const transferQuantity = Math.abs(Number(payload.quantity));
    const occurredAt = String(payload.occurredAt);
    const itemId = String(payload.itemId);
    const fromLocationId = String(payload.fromLocationId);
    const toLocationId = String(payload.toLocationId);
    const groupId = String(payload.transferGroupId);
    const outMovement: InventoryMovementRow = {
      id: String(payload.outMovementId),
      item_id: itemId,
      location_id: fromLocationId,
      movement_type: "transfer_out",
      quantity_delta: -transferQuantity,
      occurred_at: occurredAt,
      transfer_group_id: groupId,
      note: payload.note ? String(payload.note) : null,
      pending: true,
    };
    const inMovement: InventoryMovementRow = {
      id: String(payload.inMovementId),
      item_id: itemId,
      location_id: toLocationId,
      movement_type: "transfer_in",
      quantity_delta: transferQuantity,
      occurred_at: occurredAt,
      transfer_group_id: groupId,
      note: payload.note ? String(payload.note) : null,
      pending: true,
    };
    return {
      ...data,
      movements: [inMovement, outMovement, ...data.movements],
      balances: adjustBalance(
        adjustBalance(data.balances, itemId, fromLocationId, -transferQuantity),
        itemId,
        toLocationId,
        transferQuantity,
      ),
    };
  }

  if (command.action === "reverse-movement") {
    if (data.movements.some((movement) => movement.id === payload.id)) return data;
    const original = data.movements.find((movement) => movement.id === payload.reversalOfId);
    if (!original) return data;
    const reversal: InventoryMovementRow = {
      id: String(payload.id),
      item_id: original.item_id,
      location_id: original.location_id,
      movement_type: "reversal",
      quantity_delta: -Number(original.quantity_delta),
      occurred_at: String(payload.occurredAt),
      reversal_of_id: original.id,
      note: payload.note ? String(payload.note) : null,
      pending: true,
    };
    return {
      ...data,
      movements: [reversal, ...data.movements],
      balances: adjustBalance(data.balances, reversal.item_id, reversal.location_id, reversal.quantity_delta),
    };
  }

  return data;
}

function readDemoInventory(): InventoryData {
  try {
    const value = JSON.parse(window.localStorage.getItem(DEMO_STORAGE_KEY) ?? "null") as InventoryData | null;
    return value && Array.isArray(value.items) && Array.isArray(value.locations) ? value : emptyInventory;
  } catch {
    window.localStorage.removeItem(DEMO_STORAGE_KEY);
    return emptyInventory;
  }
}

export default function InventoryPage() {
  const { state, mode } = useBdb();
  const [data, setData] = useState<InventoryData>(emptyInventory);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [pendingCount, setPendingCount] = useState(0);
  const [syncing, setSyncing] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [locationOpen, setLocationOpen] = useState(false);
  const [movementOpen, setMovementOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [query, setQuery] = useState("");
  const [itemForm, setItemForm] = useState({
    sku: "",
    name: "",
    purpose: "resale" as InventoryItemPurpose,
    unitLabel: "unit",
    reorderPoint: "0",
    targetQuantity: "0",
    unitCost: "0",
    unitPrice: "",
  });
  const [locationForm, setLocationForm] = useState({ code: "MAIN", name: "Main stock", isDefault: true });
  const [movementForm, setMovementForm] = useState({
    itemId: "",
    locationId: "",
    destinationLocationId: "",
    type: "purchase_receipt" as InventoryMovementType | "transfer",
    quantity: "",
    note: "",
  });

  const loadCloud = useCallback(async () => {
    setError("");
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }
    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    const response = await fetch(`/api/inventory?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Inventory could not be loaded.");
    const cloud = result.result as InventoryData;
    const queue = readInventoryQueue(currentWorkspaceId);
    const withPending = queue.reduce(applyCommand, {
      items: cloud.items ?? [],
      locations: cloud.locations ?? [],
      balances: cloud.balances ?? [],
      movements: cloud.movements ?? [],
    });
    setData(withPending);
    setPendingCount(queue.length);
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      try {
        if (mode === "demo") {
          if (active) setData(readDemoInventory());
        } else {
          await loadCloud();
        }
      } catch (initialError) {
        if (active) setError(initialError instanceof Error ? initialError.message : "Inventory could not be loaded.");
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [loadCloud, mode]);

  useEffect(() => {
    if (mode === "demo" && loaded) {
      window.localStorage.setItem(DEMO_STORAGE_KEY, JSON.stringify(data));
    }
  }, [data, loaded, mode]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || syncing) return;
    setSyncing(true);
    setError("");
    const result = await flushInventoryQueue(workspaceId, setPendingCount);
    setPendingCount(result.remaining);
    if (result.completed > 0) setNotice(`${result.completed} queued inventory change${result.completed === 1 ? "" : "s"} synced.`);
    await loadCloud().catch((syncError) => setError(syncError instanceof Error ? syncError.message : "Inventory could not be refreshed."));
    setSyncing(false);
  }, [loadCloud, syncing, workspaceId]);

  useEffect(() => {
    if (mode !== "cloud") return;
    const online = () => void syncPending();
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [mode, syncPending]);

  const submitCommand = useCallback(async (
    action: InventoryCommandAction,
    payload: Record<string, unknown>,
  ) => {
    setError("");
    setNotice("");
    const commandId = crypto.randomUUID();
    const command: InventoryQueuedCommand = {
      id: commandId,
      workspaceId: workspaceId ?? "demo",
      action,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    setData((current) => applyCommand(current, command));

    if (mode === "demo") {
      setNotice("Saved in this browser's local BDB OS preview.");
      return true;
    }
    if (!workspaceId) {
      setError("The current workspace is unavailable.");
      return false;
    }

    enqueueInventoryCommand(workspaceId, action, payload, commandId);
    setPendingCount(readInventoryQueue(workspaceId).length);
    if (!navigator.onLine) {
      setNotice("Saved offline. BDB OS will retry this inventory change when the connection returns.");
      return true;
    }

    try {
      await submitInventoryCommand(command);
      removeInventoryCommand(workspaceId, command.id);
      setPendingCount(readInventoryQueue(workspaceId).length);
      await loadCloud();
      setNotice("Inventory change saved.");
      return true;
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Inventory change could not be saved.";
      failInventoryCommand(workspaceId, command.id, message);
      setPendingCount(readInventoryQueue(workspaceId).length);
      setError(`${message} The change remains in the local retry queue.`);
      return false;
    }
  }, [loadCloud, mode, workspaceId]);

  const balancesByItem = useMemo(() => new Map(data.items.map((item) => [
    item.id,
    quantity(data.balances.filter((balance) => balance.item_id === item.id).reduce((total, balance) => total + Number(balance.quantity), 0)),
  ])), [data.balances, data.items]);

  const itemSnapshots = useMemo(() => data.items.map((item) => ({
    id: item.id,
    name: item.name,
    sku: item.sku,
    quantity: balancesByItem.get(item.id) ?? 0,
    reorderPoint: Number(item.reorder_point),
    targetQuantity: Number(item.target_quantity),
    unitCost: Number(item.unit_cost),
    unitPrice: item.unit_price === null ? undefined : Number(item.unit_price),
    purpose: item.purpose,
    active: item.active,
  })), [balancesByItem, data.items]);

  const summary = useMemo(() => summariseInventory(itemSnapshots), [itemSnapshots]);
  const visibleItems = itemSnapshots.filter((item) => [item.name, item.sku, item.purpose].join(" ").toLowerCase().includes(query.toLowerCase()));
  const hasNegativeStock = itemSnapshots.some((item) => item.quantity < 0);

  async function createItem(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const saved = await submitCommand("create-item", {
      id: crypto.randomUUID(),
      ...itemForm,
      reorderPoint: Number(itemForm.reorderPoint),
      targetQuantity: Number(itemForm.targetQuantity),
      unitCost: Number(itemForm.unitCost),
      unitPrice: itemForm.unitPrice === "" ? null : Number(itemForm.unitPrice),
    });
    setSaving(false);
    if (!saved) return;
    setItemForm({ sku: "", name: "", purpose: "resale", unitLabel: "unit", reorderPoint: "0", targetQuantity: "0", unitCost: "0", unitPrice: "" });
    setItemOpen(false);
  }

  async function createLocation(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    const saved = await submitCommand("create-location", { id: crypto.randomUUID(), ...locationForm });
    setSaving(false);
    if (!saved) return;
    setLocationForm({ code: "", name: "", isDefault: data.locations.length === 0 });
    setLocationOpen(false);
  }

  async function postMovement(event: FormEvent) {
    event.preventDefault();
    if (saving || !movementForm.itemId || !movementForm.locationId || !movementForm.quantity) return;
    setSaving(true);
    const occurredAt = new Date().toISOString();
    const saved = movementForm.type === "transfer"
      ? await submitCommand("transfer-stock", {
        outMovementId: crypto.randomUUID(),
        inMovementId: crypto.randomUUID(),
        transferGroupId: crypto.randomUUID(),
        itemId: movementForm.itemId,
        fromLocationId: movementForm.locationId,
        toLocationId: movementForm.destinationLocationId,
        quantity: Math.abs(Number(movementForm.quantity)),
        note: movementForm.note,
        occurredAt,
      })
      : await submitCommand("post-movement", {
        id: crypto.randomUUID(),
        itemId: movementForm.itemId,
        locationId: movementForm.locationId,
        movementType: movementForm.type,
        quantity: normaliseInventoryMovementDelta(movementForm.type, Number(movementForm.quantity)),
        note: movementForm.note,
        occurredAt,
      });
    setSaving(false);
    if (!saved) return;
    setMovementForm((current) => ({ ...current, quantity: "", note: "" }));
    setMovementOpen(false);
  }

  async function reverseMovement(movement: InventoryMovementRow) {
    if (saving) return;
    setSaving(true);
    await submitCommand("reverse-movement", {
      id: crypto.randomUUID(),
      itemId: movement.item_id,
      locationId: movement.location_id,
      reversalOfId: movement.id,
      occurredAt: new Date().toISOString(),
      note: `Correction for ${movement.movement_type.replaceAll("_", " ")}`,
    });
    setSaving(false);
  }

  function discardQueue() {
    if (!workspaceId) return;
    writeInventoryQueue(workspaceId, []);
    setPendingCount(0);
    void loadCloud();
    setNotice("Pending local inventory changes were discarded.");
  }

  if (!loaded) return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Inventory…</main>;

  return (
    <>
      <PageHeader
        eyebrow="Operations workspace"
        title="Inventory"
        description="Products, consumables and every stock change in one traceable movement ledger."
        action={<div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <Button variant="secondary" onClick={() => setLocationOpen(true)}><MapPin size={17} /> Add location</Button>
          <Button variant="secondary" onClick={() => setItemOpen(true)}><Plus size={17} /> Add item</Button>
          <Button disabled={!data.items.length || !data.locations.length} onClick={() => {
            setMovementForm((current) => ({
              ...current,
              itemId: current.itemId || data.items[0]?.id || "",
              locationId: current.locationId || data.locations[0]?.id || "",
              destinationLocationId: current.destinationLocationId || data.locations[1]?.id || "",
            }));
            setMovementOpen(true);
          }}><Boxes size={17} /> Record movement</Button>
        </div>}
      />

      {error ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Inventory needs attention</strong><p>{error}</p></div></div> : null}
      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Inventory updated</strong><p>{notice}</p></div> : null}
      {hasNegativeStock ? <div className="review-callout"><TriangleAlert size={19} /><div><strong>Negative stock recorded</strong><p>The ledger remains append-only. Add a receipt or corrective reversal rather than editing a posted movement.</p></div></div> : null}
      {pendingCount > 0 ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>{pendingCount} change{pendingCount === 1 ? "" : "s"} waiting to sync</strong><p>Inventory commands are stored locally with stable retry keys.</p><div style={{ display: "flex", gap: 8, marginTop: 10 }}><Button variant="secondary" disabled={syncing} onClick={() => void syncPending()}><RefreshCw size={16} className={syncing ? "spin" : ""} /> Retry</Button><Button variant="quiet" onClick={discardQueue}>Discard local changes</Button></div></div> : null}

      <div className="stat-grid">
        <StatCard label="Active items" value={String(summary.activeItemCount)} detail="Products and consumables" icon={<Boxes size={19} />} />
        <StatCard label="Units on hand" value={String(summary.totalUnits)} detail={summary.totalUnits < 0 ? "Correction required" : "Across all locations"} icon={<MapPin size={19} />} />
        <StatCard label="Low or out" value={String(summary.lowStockItemCount + summary.outOfStockItemCount)} detail="At or below reorder point" icon={<TriangleAlert size={19} />} />
        <StatCard label="Cost value" value={formatMoney(summary.costValue, state.settings.currency)} detail="Based on current unit cost" icon={<CircleDollarSign size={19} />} />
      </div>

      <div className="toolbar">
        <input className="filter-input" placeholder="Search item name, SKU or purpose…" value={query} onChange={(event) => setQuery(event.target.value)} />
        <Badge tone={mode === "demo" ? "blue" : pendingCount ? "gold" : "green"}>{mode === "demo" ? "Local preview" : pendingCount ? "Pending sync" : "Ledger synced"}</Badge>
      </div>

      <Card className="table-card">
        <div className="table-scroll">
          <table>
            <thead><tr><th>Item</th><th>Purpose</th><th className="align-right">On hand</th><th>Status</th><th className="align-right">Reorder</th><th className="align-right">Unit value</th></tr></thead>
            <tbody>
              {visibleItems.map((item) => {
                const status = inventoryStockStatus(item);
                const raw = data.items.find((entry) => entry.id === item.id);
                return <tr key={item.id}>
                  <td className="cell-stack"><strong>{item.name}</strong><span>{item.sku}{raw?.pending ? " · pending" : ""}</span></td>
                  <td><Badge tone={item.purpose === "resale" ? "gold" : "blue"}>{item.purpose}</Badge></td>
                  <td className="align-right"><strong>{item.quantity} {raw?.unit_label ?? "unit"}{Math.abs(item.quantity) === 1 ? "" : "s"}</strong></td>
                  <td><Badge tone={status === "in-stock" ? "green" : status === "low-stock" ? "gold" : "red"}>{status.replaceAll("-", " ")}</Badge></td>
                  <td className="align-right"><strong>{suggestedReorderQuantity(item)}</strong><span className="muted small"> to target</span></td>
                  <td className="align-right"><strong>{formatMoney(item.unitCost, state.settings.currency)}</strong>{item.unitPrice !== undefined ? <div className="muted small">Sell {formatMoney(item.unitPrice, state.settings.currency)}</div> : null}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>
        {visibleItems.length === 0 ? <EmptyState icon={<Boxes size={24} />} title="No inventory items" description={query ? "Change the search term." : "Add the first product or consumable, then record its opening balance."} /> : null}
      </Card>

      <div style={{ marginTop: 28 }}>
        <SectionHeading title="Recent stock movements" description="Posted entries are immutable. Corrections create reversing movements." />
        <Card className="table-card">
          <div className="table-scroll">
            <table>
              <thead><tr><th>Movement</th><th>Item</th><th>Location</th><th>When</th><th className="align-right">Quantity</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {data.movements.slice(0, 30).map((movement) => {
                  const item = data.items.find((entry) => entry.id === movement.item_id);
                  const location = data.locations.find((entry) => entry.id === movement.location_id);
                  const reversed = data.movements.some((entry) => entry.reversal_of_id === movement.id);
                  const canReverse = !reversed && movement.movement_type !== "reversal" && !movement.movement_type.startsWith("transfer_");
                  return <tr key={movement.id}>
                    <td className="cell-stack"><strong>{movement.movement_type.replaceAll("_", " ")}</strong><span>{movement.pending ? "Waiting to sync" : movement.note || "Posted ledger entry"}</span></td>
                    <td><strong>{item?.name ?? "Unknown item"}</strong></td>
                    <td>{location?.name ?? "Unknown location"}</td>
                    <td>{formatTimeAgo(movement.occurred_at)}</td>
                    <td className="align-right"><strong>{Number(movement.quantity_delta) > 0 ? "+" : ""}{quantity(movement.quantity_delta)}</strong></td>
                    <td>{canReverse ? <button className="link-button" disabled={saving || movement.pending} onClick={() => void reverseMovement(movement)}><RotateCcw size={15} /> Reverse</button> : <span className="muted small">{reversed ? "Reversed" : "—"}</span>}</td>
                  </tr>;
                })}
              </tbody>
            </table>
          </div>
          {data.movements.length === 0 ? <EmptyState icon={<RefreshCw size={24} />} title="No stock movements" description="Record an opening balance, receipt or adjustment to establish stock." /> : null}
        </Card>
      </div>

      <Dialog open={locationOpen} onClose={() => { if (!saving) setLocationOpen(false); }} title="Add stock location" description="Locations separate stock held in shops, treatment rooms, vans or storage areas.">
        <form onSubmit={createLocation}>
          <div className="form-grid">
            <div className="field"><label htmlFor="location-code">Code</label><input id="location-code" required value={locationForm.code} onChange={(event) => setLocationForm({ ...locationForm, code: event.target.value })} placeholder="MAIN" /></div>
            <div className="field"><label htmlFor="location-name">Name</label><input id="location-name" required value={locationForm.name} onChange={(event) => setLocationForm({ ...locationForm, name: event.target.value })} placeholder="Main stock" /></div>
            <label className="field field-full" style={{ display: "flex", flexDirection: "row", alignItems: "center", gap: 10 }}><input type="checkbox" checked={locationForm.isDefault} onChange={(event) => setLocationForm({ ...locationForm, isDefault: event.target.checked })} /> Use as the default stock location</label>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={saving} onClick={() => setLocationOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Add location"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={itemOpen} onClose={() => { if (!saving) setItemOpen(false); }} title="Add inventory item" description="Use neutral item records; industry wording belongs to the workspace template.">
        <form onSubmit={createItem}>
          <div className="form-grid">
            <div className="field"><label htmlFor="item-sku">SKU</label><input id="item-sku" required value={itemForm.sku} onChange={(event) => setItemForm({ ...itemForm, sku: event.target.value })} placeholder="ITEM-001" /></div>
            <div className="field"><label htmlFor="item-purpose">Purpose</label><select id="item-purpose" value={itemForm.purpose} onChange={(event) => setItemForm({ ...itemForm, purpose: event.target.value as InventoryItemPurpose })}><option value="resale">Resale product</option><option value="consumable">Service consumable</option></select></div>
            <div className="field field-full"><label htmlFor="item-name">Name</label><input id="item-name" required value={itemForm.name} onChange={(event) => setItemForm({ ...itemForm, name: event.target.value })} placeholder="Inventory item name" /></div>
            <div className="field"><label htmlFor="item-unit">Unit</label><input id="item-unit" required value={itemForm.unitLabel} onChange={(event) => setItemForm({ ...itemForm, unitLabel: event.target.value })} placeholder="unit" /></div>
            <div className="field"><label htmlFor="item-reorder">Reorder point</label><input id="item-reorder" type="number" min="0" step="0.001" required value={itemForm.reorderPoint} onChange={(event) => setItemForm({ ...itemForm, reorderPoint: event.target.value })} /></div>
            <div className="field"><label htmlFor="item-target">Target quantity</label><input id="item-target" type="number" min={Number(itemForm.reorderPoint || 0)} step="0.001" required value={itemForm.targetQuantity} onChange={(event) => setItemForm({ ...itemForm, targetQuantity: event.target.value })} /></div>
            <div className="field"><label htmlFor="item-cost">Unit cost</label><input id="item-cost" type="number" min="0" step="0.0001" required value={itemForm.unitCost} onChange={(event) => setItemForm({ ...itemForm, unitCost: event.target.value })} /></div>
            <div className="field"><label htmlFor="item-price">Unit price</label><input id="item-price" type="number" min="0" step="0.0001" value={itemForm.unitPrice} onChange={(event) => setItemForm({ ...itemForm, unitPrice: event.target.value })} placeholder="Optional" /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={saving} onClick={() => setItemOpen(false)}>Cancel</Button><Button type="submit" disabled={saving}>{saving ? "Saving…" : "Add item"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={movementOpen} onClose={() => { if (!saving) setMovementOpen(false); }} title="Record stock movement" description="The resulting ledger entry cannot be edited. Use a reversal for corrections.">
        <form onSubmit={postMovement}>
          <div className="form-grid">
            <div className="field field-full"><label htmlFor="movement-item">Item</label><select id="movement-item" required value={movementForm.itemId} onChange={(event) => setMovementForm({ ...movementForm, itemId: event.target.value })}>{data.items.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name} · {item.sku}</option>)}</select></div>
            <div className="field"><label htmlFor="movement-type">Movement</label><select id="movement-type" value={movementForm.type} onChange={(event) => setMovementForm({ ...movementForm, type: event.target.value as InventoryMovementType | "transfer" })}><option value="opening_balance">Opening balance</option><option value="purchase_receipt">Purchase receipt</option><option value="customer_return">Customer return</option><option value="sale">Sale</option><option value="appointment_consumption">Appointment consumption</option><option value="supplier_return">Supplier return</option><option value="write_off">Damage / write-off</option><option value="manual_adjustment">Manual adjustment</option><option value="transfer">Transfer between locations</option></select></div>
            <div className="field"><label htmlFor="movement-quantity">Quantity</label><input id="movement-quantity" type="number" step="0.001" required value={movementForm.quantity} onChange={(event) => setMovementForm({ ...movementForm, quantity: event.target.value })} placeholder={movementForm.type === "manual_adjustment" ? "Use + or -" : "Positive quantity"} /></div>
            <div className="field"><label htmlFor="movement-location">{movementForm.type === "transfer" ? "From location" : "Location"}</label><select id="movement-location" required value={movementForm.locationId} onChange={(event) => setMovementForm({ ...movementForm, locationId: event.target.value })}>{data.locations.filter((location) => location.active).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
            {movementForm.type === "transfer" ? <div className="field"><label htmlFor="movement-destination">To location</label><select id="movement-destination" required value={movementForm.destinationLocationId} onChange={(event) => setMovementForm({ ...movementForm, destinationLocationId: event.target.value })}><option value="">Choose destination</option>{data.locations.filter((location) => location.active && location.id !== movementForm.locationId).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div> : null}
            <div className="field field-full"><label htmlFor="movement-note">Reason or note</label><input id="movement-note" value={movementForm.note} onChange={(event) => setMovementForm({ ...movementForm, note: event.target.value })} placeholder="Optional but recommended for adjustments and write-offs" /></div>
          </div>
          <div className="dialog-actions"><Button type="button" variant="quiet" disabled={saving} onClick={() => setMovementOpen(false)}>Cancel</Button><Button type="submit" disabled={saving || (movementForm.type === "transfer" && !movementForm.destinationLocationId)}>{saving ? "Posting…" : "Post movement"}</Button></div>
        </form>
      </Dialog>
    </>
  );
}
