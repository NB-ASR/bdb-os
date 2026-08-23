"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useRouter } from "next/navigation";
import {
  CalendarCheck2,
  ClipboardMinus,
  PackageCheck,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  TriangleAlert,
  Warehouse,
} from "lucide-react";
import { Badge, Button, Card, Dialog, PageHeader, SectionHeading, StatCard } from "@/components/ui";
import { useBdb } from "@/lib/store";
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
import styles from "./appointment-consumption.module.css";

type CompletedAppointment = {
  id: string;
  reference: string;
  customer_id: string;
  customer_name_snapshot: string | null;
  service_id: string;
  service_code_snapshot: string | null;
  title: string;
  staff_user_id: string | null;
  staff_name: string;
  completed_at: string;
  status: "completed";
};

type SupplyProduct = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  purpose: "supply";
  unit_label: string;
  unit_cost: number;
  status: "active";
};

type InventoryLocation = {
  id: string;
  code: string;
  name: string;
  is_default: boolean;
  status: "active";
};

type StockBalance = {
  workspace_id: string;
  product_id: string;
  location_id: string;
  quantity: number;
};

type ConsumptionMovement = {
  id: string;
  workspace_id: string;
  product_id: string;
  location_id: string;
  appointment_id: string;
  movement_type: "internal_consumption" | "reversal";
  quantity_delta: number;
  unit_cost: number | null;
  currency: string | null;
  source_type: "appointment_consumption";
  source_id: string;
  reversal_of_id: string | null;
  note: string | null;
  metadata: Record<string, unknown>;
  occurred_at: string;
  posted_at: string;
  actor_user_id: string;
};

type ConsumptionBundle = {
  workspaceId: string;
  canManage: boolean;
  currency: string;
  timezone: string;
  completedAppointments: CompletedAppointment[];
  supplyProducts: SupplyProduct[];
  locations: InventoryLocation[];
  balances: StockBalance[];
  movements: ConsumptionMovement[];
};

type ConsumptionForm = {
  appointmentId: string;
  productId: string;
  locationId: string;
  quantity: string;
  occurredAt: string;
  note: string;
};

const CACHE_PREFIX = "bdb-appointment-consumption-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-appointment-consumption-last-workspace-v1";
const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;
const consumptionActions = new Set<InventoryCommandAction>([
  "post-appointment-consumption",
  "reverse-appointment-consumption",
]);

const emptyBundle: ConsumptionBundle = {
  workspaceId: "",
  canManage: false,
  currency: "GBP",
  timezone: "Europe/London",
  completedAppointments: [],
  supplyProducts: [],
  locations: [],
  balances: [],
  movements: [],
};

const emptyForm: ConsumptionForm = {
  appointmentId: "",
  productId: "",
  locationId: "",
  quantity: "1",
  occurredAt: "",
  note: "",
};

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function readLastWorkspace() {
  return typeof window === "undefined" ? null : window.localStorage.getItem(LAST_WORKSPACE_KEY);
}

function rememberWorkspace(workspaceId: string) {
  if (typeof window !== "undefined") window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}

function readBundle(workspaceId: string): ConsumptionBundle | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as ConsumptionBundle | null;
    return value
      && Array.isArray(value.completedAppointments)
      && Array.isArray(value.supplyProducts)
      && Array.isArray(value.movements)
      ? value
      : null;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return null;
  }
}

function writeBundle(workspaceId: string, bundle: ConsumptionBundle) {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(cacheKey(workspaceId), JSON.stringify(bundle));
  }
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 3 }).format(value);
}

export default function AppointmentConsumptionPage() {
  const router = useRouter();
  const { mode } = useBdb();
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [bundle, setBundle] = useState<ConsumptionBundle>(emptyBundle);
  const [form, setForm] = useState<ConsumptionForm>(emptyForm);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [pendingCommands, setPendingCommands] = useState<InventoryQueuedCommand[]>([]);
  const [inventoryQueueCount, setInventoryQueueCount] = useState(0);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reversing, setReversing] = useState<ConsumptionMovement | null>(null);
  const [reversalReason, setReversalReason] = useState("");
  const syncInFlight = useRef(false);

  const refreshQueueState = useCallback((targetWorkspaceId: string) => {
    const queue = readInventoryQueue(targetWorkspaceId);
    setInventoryQueueCount(queue.length);
    setPendingCommands(queue.filter((command) => consumptionActions.has(command.action)));
  }, []);

  const loadCloud = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }

    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    rememberWorkspace(currentWorkspaceId);

    const response = await fetch(
      `/api/appointment-consumption?workspaceId=${encodeURIComponent(currentWorkspaceId)}`,
      { cache: "no-store" },
    );
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Appointment Product consumption could not be loaded.");
    }

    const cloudBundle = result.result as ConsumptionBundle;
    writeBundle(currentWorkspaceId, cloudBundle);
    setBundle(cloudBundle);
    setForm((current) => {
      const appointmentId = cloudBundle.completedAppointments.some((item) => item.id === current.appointmentId)
        ? current.appointmentId
        : cloudBundle.completedAppointments[0]?.id ?? "";
      const appointment = cloudBundle.completedAppointments.find((item) => item.id === appointmentId) ?? null;
      return {
        ...current,
        appointmentId,
        productId: cloudBundle.supplyProducts.some((item) => item.id === current.productId)
          ? current.productId
          : cloudBundle.supplyProducts[0]?.id ?? "",
        locationId: cloudBundle.locations.some((item) => item.id === current.locationId)
          ? current.locationId
          : cloudBundle.locations.find((item) => item.is_default)?.id ?? cloudBundle.locations[0]?.id ?? "",
        occurredAt: current.occurredAt || (appointment?.completed_at ? localDateTime(appointment.completed_at) : localDateTime(new Date().toISOString())),
      };
    });
    refreshQueueState(currentWorkspaceId);
  }, [refreshQueueState]);

  useEffect(() => {
    const updateOnline = () => setOnline(navigator.onLine);
    updateOnline();
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    return () => {
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const fallbackWorkspace = mode === "demo" ? "demo" : readLastWorkspace();
        const cached = fallbackWorkspace && fallbackWorkspace !== "demo" ? readBundle(fallbackWorkspace) : null;
        if (fallbackWorkspace) {
          setWorkspaceId(fallbackWorkspace);
          if (fallbackWorkspace !== "demo") refreshQueueState(fallbackWorkspace);
        }
        if (cached) {
          setBundle(cached);
          setNotice("Showing the last cached Appointment Product usage while cloud data refreshes.");
        }

        try {
          if (mode === "demo") {
            setNotice("Appointment Product consumption requires a connected workspace.");
            return;
          }
          if (!navigator.onLine) {
            if (cached) setNotice("Showing cached Appointment Product usage. New commands remain queued until the connection returns.");
            else setError("This workspace needs one successful online load before Appointment Product usage can open offline.");
            return;
          }
          await loadCloud();
        } catch (loadError) {
          if (cached) setNotice("Showing cached Appointment Product usage while cloud access is unavailable.");
          else setError(loadError instanceof Error ? loadError.message : "Appointment Product consumption could not be loaded.");
        } finally {
          setLoaded(true);
        }
      })();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCloud, mode, refreshQueueState]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || syncInFlight.current) return;
    syncInFlight.current = true;
    setSyncing(true);
    setError("");
    try {
      const result = await flushInventoryQueue(workspaceId, () => refreshQueueState(workspaceId));
      refreshQueueState(workspaceId);
      if (result.completed) {
        setNotice(`${result.completed} queued Inventory command${result.completed === 1 ? "" : "s"} synced in order.`);
      }
      await loadCloud();
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Inventory commands could not be synchronised.");
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [loadCloud, refreshQueueState, workspaceId]);

  useEffect(() => {
    if (mode === "cloud" && online && inventoryQueueCount > 0 && !syncInFlight.current) {
      void syncPending();
    }
  }, [inventoryQueueCount, mode, online, syncPending]);

  const submitCommand = useCallback(async (
    action: InventoryCommandAction,
    payload: Record<string, unknown>,
  ) => {
    setError("");
    setNotice("");
    if (mode === "demo") {
      setError("Appointment Product consumption requires a connected workspace.");
      return false;
    }
    if (!workspaceId) {
      setError("The current workspace is unavailable.");
      return false;
    }

    const command = enqueueInventoryCommand(workspaceId, action, payload);
    refreshQueueState(workspaceId);
    if (!navigator.onLine) {
      setNotice("Saved offline. BDB OS will revalidate and post this Inventory command when the connection returns.");
      return true;
    }

    try {
      await submitInventoryCommand(command);
      removeInventoryCommand(workspaceId, command.id);
      refreshQueueState(workspaceId);
      await loadCloud();
      setNotice(action === "post-appointment-consumption"
        ? "Appointment Product consumption posted."
        : "Appointment Product consumption reversed.");
      return true;
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Inventory command could not be saved.";
      failInventoryCommand(workspaceId, command.id, message);
      refreshQueueState(workspaceId);
      setError(`${message} The command remains in the ordered Inventory review queue.`);
      return false;
    }
  }, [loadCloud, mode, refreshQueueState, workspaceId]);

  const appointmentMap = useMemo(
    () => new Map(bundle.completedAppointments.map((appointment) => [appointment.id, appointment])),
    [bundle.completedAppointments],
  );
  const productMap = useMemo(
    () => new Map(bundle.supplyProducts.map((product) => [product.id, product])),
    [bundle.supplyProducts],
  );
  const locationMap = useMemo(
    () => new Map(bundle.locations.map((location) => [location.id, location])),
    [bundle.locations],
  );
  const reversalByOriginal = useMemo(
    () => new Map(
      bundle.movements
        .filter((movement) => movement.movement_type === "reversal" && movement.reversal_of_id)
        .map((movement) => [movement.reversal_of_id as string, movement]),
    ),
    [bundle.movements],
  );
  const pendingReversals = useMemo(
    () => new Set(
      pendingCommands
        .filter((command) => command.action === "reverse-appointment-consumption")
        .map((command) => String(command.payload.movementId ?? "")),
    ),
    [pendingCommands],
  );
  const originalMovements = useMemo(
    () => bundle.movements.filter((movement) => movement.movement_type === "internal_consumption"),
    [bundle.movements],
  );
  const visibleMovements = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return originalMovements;
    return originalMovements.filter((movement) => {
      const appointment = appointmentMap.get(movement.appointment_id);
      const product = productMap.get(movement.product_id);
      const location = locationMap.get(movement.location_id);
      return [
        appointment?.reference,
        appointment?.customer_name_snapshot,
        appointment?.title,
        product?.sku,
        product?.name,
        location?.code,
        location?.name,
        movement.note,
      ].join(" ").toLowerCase().includes(term);
    });
  }, [appointmentMap, locationMap, originalMovements, productMap, query]);

  const selectedProduct = productMap.get(form.productId) ?? null;
  const selectedAppointment = appointmentMap.get(form.appointmentId) ?? null;
  const selectedLocation = locationMap.get(form.locationId) ?? null;
  const recordedBalance = Number(bundle.balances.find(
    (balance) => balance.product_id === form.productId && balance.location_id === form.locationId,
  )?.quantity ?? 0);
  const requestedQuantity = Number(form.quantity || 0);
  const projectedBalance = recordedBalance - (Number.isFinite(requestedQuantity) ? requestedQuantity : 0);
  const createsNegativeBalance = Number.isFinite(requestedQuantity)
    && requestedQuantity > 0
    && projectedBalance < 0;
  const activeMovements = originalMovements.filter((movement) => !reversalByOriginal.has(movement.id));
  const estimatedCost = activeMovements.reduce(
    (total, movement) => total + Math.abs(Number(movement.quantity_delta)) * Number(movement.unit_cost ?? 0),
    0,
  );
  const currency = useMemo(
    () => new Intl.NumberFormat("en-GB", { style: "currency", currency: bundle.currency }),
    [bundle.currency],
  );

  async function recordConsumption(event: FormEvent) {
    event.preventDefault();
    if (!bundle.canManage || saving) return;
    if (!selectedAppointment || !selectedProduct || !selectedLocation) {
      setError("Choose a completed Appointment, supply Product and Inventory location.");
      return;
    }
    if (!Number.isFinite(requestedQuantity) || requestedQuantity <= 0 || requestedQuantity > 100000) {
      setError("Enter a positive quantity no greater than 100,000.");
      return;
    }
    if (!form.occurredAt) {
      setError("Choose when the Product was consumed.");
      return;
    }

    setSaving(true);
    const saved = await submitCommand("post-appointment-consumption", {
      id: crypto.randomUUID(),
      appointmentId: selectedAppointment.id,
      productId: selectedProduct.id,
      locationId: selectedLocation.id,
      quantity: requestedQuantity,
      occurredAt: new Date(form.occurredAt).toISOString(),
      note: form.note,
    });
    setSaving(false);
    if (saved) {
      setForm((current) => ({ ...current, quantity: "1", note: "" }));
    }
  }

  async function reverseConsumption() {
    if (!reversing || reversalReason.trim().length < 5 || saving) return;
    setSaving(true);
    const saved = await submitCommand("reverse-appointment-consumption", {
      id: crypto.randomUUID(),
      movementId: reversing.id,
      reason: reversalReason.trim(),
      occurredAt: new Date().toISOString(),
    });
    setSaving(false);
    if (saved) {
      setReversing(null);
      setReversalReason("");
    }
  }

  async function discardConsumptionCommands() {
    if (!workspaceId || workspaceId === "demo") return;
    writeInventoryQueue(
      workspaceId,
      readInventoryQueue(workspaceId).filter((command) => !consumptionActions.has(command.action)),
    );
    refreshQueueState(workspaceId);
    setNotice("Pending Appointment Product usage commands were discarded. Other Inventory commands were preserved.");
    try {
      await loadCloud();
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Appointment Product consumption could not be refreshed.");
    }
  }

  if (!loaded && !bundle.workspaceId) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Appointment Product usage…</main>;
  }

  const prerequisitesReady = bundle.completedAppointments.length > 0
    && bundle.supplyProducts.length > 0
    && bundle.locations.length > 0;

  return (
    <>
      <PageHeader
        eyebrow="Inventory workflow"
        title="Appointment Product usage"
        description="Record internal supplies used during completed Services as explicit, reversible Inventory movements linked to the Appointment."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={() => router.push("/calendar")}>
              <CalendarCheck2 size={16} /> Open Calendar
            </Button>
            <Button
              variant="secondary"
              onClick={() => void syncPending()}
              disabled={mode !== "cloud" || !online || syncing || inventoryQueueCount === 0}
            >
              <RefreshCw className={syncing ? "spin" : ""} size={16} />
              {syncing ? "Syncing…" : `Sync Inventory${inventoryQueueCount ? ` (${inventoryQueueCount})` : ""}`}
            </Button>
            <Button variant="secondary" onClick={() => void loadCloud()} disabled={mode !== "cloud" || !online}>
              <RefreshCw size={16} /> Refresh
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <ShieldCheck size={19} />
        <div>
          <strong>Explicit stock consequence</strong>
          <p>Appointment completion never guesses Product usage. Supply Products are posted here as `internal_consumption`; resale Products leave stock only through a completed Sale.</p>
        </div>
      </div>

      {!online ? (
        <Card className="settings-note">
          <strong>Offline capture active</strong>
          <p>New usage and reversal commands stay in the shared Inventory queue. They replay in order and stop at the first conflict after reconnection.</p>
        </Card>
      ) : null}
      {!bundle.canManage && mode !== "demo" ? (
        <Card className="settings-note">
          <strong>Read-only Product usage</strong>
          <p>Inventory create or edit permission, or guarded Founder test-write access, is required to post and reverse Appointment consumption.</p>
        </Card>
      ) : null}
      {error ? <Card className="settings-note"><strong>Action needed</strong><p>{error}</p></Card> : null}
      {notice ? <div className="toast"><PackageCheck size={17} /> {notice}</div> : null}

      {pendingCommands.length > 0 ? (
        <Card className="settings-card">
          <SectionHeading
            title={`${pendingCommands.length} pending Appointment usage command${pendingCommands.length === 1 ? "" : "s"}`}
            description="These commands share Inventory ordering with locations, transfers, purchasing posts and manual corrections."
          />
          <div className={styles.pendingList}>
            {pendingCommands.map((command) => {
              const appointment = appointmentMap.get(String(command.payload.appointmentId ?? ""));
              const product = productMap.get(String(command.payload.productId ?? ""));
              return (
                <div className={styles.pendingItem} key={command.id}>
                  <div>
                    <strong>{command.action === "post-appointment-consumption" ? "Usage queued" : "Reversal queued"}</strong>
                    <small>{appointment?.reference ?? String(command.payload.movementId ?? "Inventory movement")} · {product?.name ?? "Server revalidation pending"}</small>
                    {command.lastError ? <small>Needs review: {command.lastError}</small> : null}
                  </div>
                  <Badge tone={command.lastError ? "gold" : "neutral"}>{command.attempts ? `${command.attempts} attempt${command.attempts === 1 ? "" : "s"}` : "Pending"}</Badge>
                </div>
              );
            })}
          </div>
          <div className="dialog-actions">
            <Button variant="quiet" onClick={() => void discardConsumptionCommands()}>Discard usage commands</Button>
          </div>
        </Card>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Recorded entries" value={String(originalMovements.length)} detail={`${activeMovements.length} active after reversals`} icon={<ClipboardMinus size={19} />} />
        <StatCard label="Reversals" value={String(reversalByOriginal.size)} detail="Original movements preserved" icon={<RotateCcw size={19} />} />
        <StatCard label="Estimated cost" value={currency.format(estimatedCost)} detail="Active supply usage at cost" icon={<PackageCheck size={19} />} />
        <StatCard label="Supply catalogue" value={String(bundle.supplyProducts.length)} detail={`${bundle.locations.length} active location${bundle.locations.length === 1 ? "" : "s"}`} icon={<Warehouse size={19} />} />
      </div>

      <div className={styles.grid}>
        <Card className="settings-card">
          <SectionHeading
            title="Record supply usage"
            description="Choose the completed Appointment and the internal supply that was physically consumed."
          />
          <div className={styles.cardBody}>
            {!bundle.completedAppointments.length ? (
              <div className={styles.empty}>
                <CalendarCheck2 size={24} />
                <strong>No completed Service Appointments</strong>
                <span>Complete the Appointment in Calendar before posting its stock consequence.</span>
                <Button onClick={() => router.push("/calendar")}>Open Calendar</Button>
              </div>
            ) : null}
            {!bundle.supplyProducts.length ? (
              <div className={styles.empty}>
                <PackageCheck size={24} />
                <strong>No active supply Products</strong>
                <span>Create Products with purpose “Business supply”. Resale Products belong in Sales.</span>
                <Button onClick={() => router.push("/products")}>Open Products</Button>
              </div>
            ) : null}
            {!bundle.locations.length ? (
              <div className={styles.empty}>
                <Warehouse size={24} />
                <strong>No active Inventory location</strong>
                <span>Create the stock location that physically holds the supplies.</span>
                <Button onClick={() => router.push("/inventory")}>Open stock ledger</Button>
              </div>
            ) : null}

            {prerequisitesReady ? (
              <form className={styles.formBody} onSubmit={recordConsumption}>
                <div className={styles.formGrid}>
                  <label className={styles.full}>Completed Appointment
                    <select
                      value={form.appointmentId}
                      onChange={(event) => {
                        const appointment = appointmentMap.get(event.target.value);
                        setForm((current) => ({
                          ...current,
                          appointmentId: event.target.value,
                          occurredAt: appointment?.completed_at ? localDateTime(appointment.completed_at) : current.occurredAt,
                        }));
                      }}
                      disabled={!bundle.canManage || saving}
                    >
                      {bundle.completedAppointments.map((appointment) => (
                        <option key={appointment.id} value={appointment.id}>
                          {appointment.reference} · {appointment.customer_name_snapshot || "Customer"} · {appointment.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>Supply Product
                    <select
                      value={form.productId}
                      onChange={(event) => setForm((current) => ({ ...current, productId: event.target.value }))}
                      disabled={!bundle.canManage || saving}
                    >
                      {bundle.supplyProducts.map((product) => (
                        <option key={product.id} value={product.id}>{product.name} · {product.sku}</option>
                      ))}
                    </select>
                  </label>
                  <label>Inventory location
                    <select
                      value={form.locationId}
                      onChange={(event) => setForm((current) => ({ ...current, locationId: event.target.value }))}
                      disabled={!bundle.canManage || saving}
                    >
                      {bundle.locations.map((location) => (
                        <option key={location.id} value={location.id}>{location.name} · {location.code}</option>
                      ))}
                    </select>
                  </label>
                  <label>Quantity ({selectedProduct?.unit_label ?? "units"})
                    <input
                      type="number"
                      min="0.001"
                      max="100000"
                      step="0.001"
                      value={form.quantity}
                      onChange={(event) => setForm((current) => ({ ...current, quantity: event.target.value }))}
                      disabled={!bundle.canManage || saving}
                    />
                  </label>
                  <label>Consumed at
                    <input
                      type="datetime-local"
                      value={form.occurredAt}
                      onChange={(event) => setForm((current) => ({ ...current, occurredAt: event.target.value }))}
                      disabled={!bundle.canManage || saving}
                    />
                  </label>
                  <label className={styles.full}>Usage note
                    <textarea
                      rows={3}
                      maxLength={500}
                      placeholder="Optional operational detail…"
                      value={form.note}
                      onChange={(event) => setForm((current) => ({ ...current, note: event.target.value }))}
                      disabled={!bundle.canManage || saving}
                    />
                  </label>
                </div>

                <div className={styles.balancePanel}>
                  <strong>Recorded location balance</strong>
                  <span>
                    {selectedProduct && selectedLocation
                      ? `${formatQuantity(recordedBalance)} ${selectedProduct.unit_label} at ${selectedLocation.name}; ${formatQuantity(projectedBalance)} after this command.`
                      : "Choose a Product and location."}
                  </span>
                </div>

                {createsNegativeBalance ? (
                  <div className={styles.warningPanel}>
                    <strong>Recorded stock will become negative</strong>
                    <p>The actual usage can still be recorded. The negative balance exposes a stock discrepancy that should be corrected through receiving, stocktake or an explicit adjustment—not by hiding the consumption.</p>
                  </div>
                ) : null}

                <div className={styles.boundaryPanel}>
                  <strong>Resale boundary</strong>
                  <p>Products sold to the Customer must be added to a completed Sale. This form accepts internal supplies only and does not change the Appointment Sale draft.</p>
                </div>

                <div className="dialog-actions">
                  <Button type="submit" disabled={!bundle.canManage || saving}>
                    <ClipboardMinus size={16} /> {saving ? "Saving…" : online ? "Post consumption" : "Save offline"}
                  </Button>
                </div>
              </form>
            ) : null}
          </div>
        </Card>

        <Card className="settings-card">
          <SectionHeading
            title="Appointment usage ledger"
            description="Posted movements remain immutable. Corrections create linked reversal movements."
          />
          <div className={styles.cardBody}>
            <div className={styles.toolbar}>
              <label className={styles.searchField}>
                <Search size={17} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search Appointment, Customer, Product or location…" />
              </label>
              <Badge tone="neutral">{visibleMovements.length} entr{visibleMovements.length === 1 ? "y" : "ies"}</Badge>
            </div>

            {visibleMovements.length ? (
              <div className={styles.rowList}>
                {visibleMovements.map((movement) => {
                  const appointment = appointmentMap.get(movement.appointment_id);
                  const product = productMap.get(movement.product_id);
                  const location = locationMap.get(movement.location_id);
                  const reversal = reversalByOriginal.get(movement.id);
                  const reversalQueued = pendingReversals.has(movement.id);
                  const movementCurrency = new Intl.NumberFormat("en-GB", {
                    style: "currency",
                    currency: movement.currency ?? bundle.currency,
                  });
                  const quantity = Math.abs(Number(movement.quantity_delta));
                  const cost = quantity * Number(movement.unit_cost ?? 0);
                  return (
                    <div className={styles.row} key={movement.id}>
                      <div className={styles.identity}>
                        <span className={styles.identityIcon}><ClipboardMinus size={18} /></span>
                        <div className={styles.identityText}>
                          <strong>{product?.name ?? String(movement.metadata.product_name ?? "Supply Product")} · {formatQuantity(quantity)} {product?.unit_label ?? String(movement.metadata.unit_label ?? "units")}</strong>
                          <span>{appointment?.reference ?? String(movement.metadata.appointment_reference ?? "Appointment")} · {appointment?.customer_name_snapshot ?? String(movement.metadata.customer_name ?? "Customer")}</span>
                          <small>{location?.name ?? String(movement.metadata.location_name ?? "Inventory location")} · {new Date(movement.occurred_at).toLocaleString("en-GB")} · {movementCurrency.format(cost)}</small>
                          <div className={styles.meta}>
                            <Badge tone={reversal ? "neutral" : reversalQueued ? "gold" : "green"}>
                              {reversal ? "Reversed" : reversalQueued ? "Reversal queued" : "Posted"}
                            </Badge>
                            <small>{appointment?.title ?? String(movement.metadata.service_name ?? "Service")}</small>
                            {movement.note ? <small>{movement.note}</small> : null}
                          </div>
                        </div>
                      </div>
                      <div className={styles.rowActions}>
                        <Button
                          variant="quiet"
                          disabled={!bundle.canManage || Boolean(reversal) || reversalQueued || saving}
                          onClick={() => {
                            setReversing(movement);
                            setReversalReason("");
                          }}
                        >
                          <RotateCcw size={15} /> Reverse
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.empty}>
                <ClipboardMinus size={24} />
                <strong>No Appointment Product usage found</strong>
                <span>Record a supply used during a completed Service, or change the search.</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Dialog
        open={reversing !== null}
        onClose={() => setReversing(null)}
        title="Reverse Appointment Product usage"
        description="The original Inventory movement remains in the ledger. A linked positive reversal restores the recorded quantity."
      >
        <div className={styles.formBody}>
          <div className={styles.warningPanel}>
            <TriangleAlert size={18} />
            <div>
              <strong>Correction, not deletion</strong>
              <p>Use a clear reason. Reversing stock usage does not change the completed Appointment or any Sale.</p>
            </div>
          </div>
          <label className={styles.full}>Reversal reason
            <textarea
              rows={4}
              minLength={5}
              maxLength={500}
              value={reversalReason}
              onChange={(event) => setReversalReason(event.target.value)}
              disabled={!reversing || saving}
            />
          </label>
          <div className="dialog-actions">
            <Button variant="quiet" onClick={() => setReversing(null)} disabled={saving}>Keep movement</Button>
            <Button
              variant="danger"
              onClick={() => void reverseConsumption()}
              disabled={!reversing || !bundle.canManage || saving || reversalReason.trim().length < 5}
            >
              <RotateCcw size={16} /> {saving ? "Reversing…" : online ? "Post reversal" : "Save reversal offline"}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
