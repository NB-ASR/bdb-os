"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  Archive,
  Building2,
  FileUp,
  Mail,
  Phone,
  RefreshCw,
  Search,
  TriangleAlert,
  Undo2,
  UserRound,
  UserRoundPlus,
  UsersRound,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import {
  enqueueCustomerCommand,
  failCustomerCommand,
  flushCustomerQueue,
  readCustomerQueue,
  removeCustomerCommand,
  submitCustomerCommand,
  writeCustomerQueue,
  type CustomerCommandAction,
  type CustomerQueuedCommand,
} from "@/lib/modules/customer-queue";
import { extractVanitaClients } from "@/lib/modules/customer-import";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";

type CustomerStatus = "active" | "archived";
type CustomerFilter = "active" | "archived" | "imported" | "all";

type CustomerRow = {
  id: string;
  workspace_id?: string;
  code: string;
  name: string;
  company: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  vat_number: string | null;
  notes: string | null;
  preferences: Record<string, unknown>;
  status: CustomerStatus;
  version: number;
  legacy_source: string | null;
  legacy_id: string | null;
  migration_batch_id: string | null;
  created_at?: string;
  updated_at?: string;
  pending?: boolean;
};

type CustomerForm = {
  code: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  vatNumber: string;
  preferences: string;
};

type ImportResult = {
  batchId: string;
  receivedCount: number;
  createdCount: number;
  linkedCount: number;
  skippedCount: number;
  errorCount: number;
  exceptions: Array<{ index: number; message: string }>;
};

const emptyForm: CustomerForm = {
  code: "",
  name: "",
  company: "",
  email: "",
  phone: "",
  address: "",
  vatNumber: "",
  preferences: "",
};

const CACHE_PREFIX = "bdb-customers-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-customers-last-workspace-v1";

function cacheKey(workspaceId: string) {
  return `${CACHE_PREFIX}:${workspaceId}`;
}

function readLastWorkspace() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_WORKSPACE_KEY);
}

function rememberWorkspace(workspaceId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}

function readCache(workspaceId: string): CustomerRow[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed as CustomerRow[] : [];
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return [];
  }
}

function writeCache(workspaceId: string, customers: readonly CustomerRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    cacheKey(workspaceId),
    JSON.stringify(customers.map(({ pending: _pending, ...customer }) => customer)),
  );
}

function preferenceSummary(value: Record<string, unknown> | null | undefined) {
  const summary = value?.summary;
  return typeof summary === "string" ? summary : "";
}

function formValues(customer: CustomerRow): CustomerForm {
  return {
    code: customer.code,
    name: customer.name,
    company: customer.company ?? "",
    email: customer.email ?? "",
    phone: customer.phone ?? "",
    address: customer.address ?? "",
    vatNumber: customer.vat_number ?? "",
    preferences: preferenceSummary(customer.preferences),
  };
}

function customerFromPayload(payload: Record<string, unknown>): CustomerRow {
  return {
    id: String(payload.id),
    code: String(payload.code || `CUS-${String(payload.id).replaceAll("-", "").slice(-16).toUpperCase()}`),
    name: String(payload.name),
    company: String(payload.company ?? ""),
    email: payload.email ? String(payload.email) : null,
    phone: payload.phone ? String(payload.phone) : null,
    address: payload.address ? String(payload.address) : null,
    vat_number: payload.vatNumber ? String(payload.vatNumber) : null,
    notes: null,
    preferences: (payload.preferences && typeof payload.preferences === "object" && !Array.isArray(payload.preferences))
      ? payload.preferences as Record<string, unknown>
      : {},
    status: "active",
    version: 1,
    legacy_source: null,
    legacy_id: null,
    migration_batch_id: null,
    pending: true,
  };
}

function applyCommand(customers: readonly CustomerRow[], command: CustomerQueuedCommand): CustomerRow[] {
  const payload = command.payload;
  const customerId = String(payload.id);

  if (command.action === "create") {
    if (customers.some((customer) => customer.id === customerId)) return [...customers];
    return [...customers, customerFromPayload(payload)];
  }

  return customers.map((customer) => {
    if (customer.id !== customerId) return customer;
    if (command.action === "update") {
      return {
        ...customer,
        ...customerFromPayload(payload),
        id: customer.id,
        notes: customer.notes,
        status: customer.status,
        legacy_source: customer.legacy_source,
        legacy_id: customer.legacy_id,
        migration_batch_id: customer.migration_batch_id,
        version: Number(payload.expectedVersion ?? customer.version) + 1,
        pending: true,
      };
    }
    return {
      ...customer,
      status: command.action === "archive" ? "archived" : "active",
      version: Number(payload.expectedVersion ?? customer.version) + 1,
      pending: true,
    };
  });
}

export default function CustomersPage() {
  const { mode } = useBdb();
  const router = useRouter();
  const importInputRef = useRef<HTMLInputElement>(null);
  const [customers, setCustomers] = useState<CustomerRow[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("active");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [duplicateReview, setDuplicateReview] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const supportMode = false;

  const loadCloud = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }

    const currentWorkspaceId = String(context.currentWorkspaceId);
    setWorkspaceId(currentWorkspaceId);
    rememberWorkspace(currentWorkspaceId);
    const response = await fetch(`/api/customers?workspaceId=${encodeURIComponent(currentWorkspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Customers could not be loaded.");

    const cloudCustomers = (result.result?.customers ?? []) as CustomerRow[];
    writeCache(currentWorkspaceId, cloudCustomers);
    const queue = readCustomerQueue(currentWorkspaceId);
    setCustomers(queue.reduce(applyCommand, cloudCustomers));
    setPendingCount(queue.length);
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastWorkspace();
      const cached = fallbackWorkspace ? readCache(fallbackWorkspace) : [];
      const queued = fallbackWorkspace ? readCustomerQueue(fallbackWorkspace) : [];

      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        setCustomers(queued.reduce(applyCommand, cached));
        setPendingCount(queued.length);
      }

      try {
        setError("");
        if (mode === "demo") return;
        if (!navigator.onLine) {
          if (cached.length || queued.length) {
            setNotice("Showing the last cached Customer directory. Changes will remain queued until the connection returns.");
          } else {
            setError("Customers need one successful online load before this workspace can open from a cold offline start.");
          }
          return;
        }
        await loadCloud();
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Customers could not be loaded.";
        if (cached.length || queued.length) {
          if (active) setNotice("Showing the last cached Customer directory while cloud access is unavailable.");
        } else if (active) {
          setError(message);
        }
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [loadCloud, mode]);

  useEffect(() => {
    if (mode === "demo" && loaded) writeCache("demo", customers);
  }, [customers, loaded, mode]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || syncing) return;
    setSyncing(true);
    setError("");
    const result = await flushCustomerQueue(workspaceId, setPendingCount);
    setPendingCount(result.remaining);
    if (result.completed) {
      setNotice(`${result.completed} queued Customer change${result.completed === 1 ? "" : "s"} synced.`);
    }
    await loadCloud().catch((syncError) => {
      setError(syncError instanceof Error ? syncError.message : "Customers could not be refreshed.");
    });
    setSyncing(false);
  }, [loadCloud, syncing, workspaceId]);

  useEffect(() => {
    if (mode !== "cloud") return;
    const handleOnline = () => void syncPending();
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [mode, syncPending]);

  const submitCommand = useCallback(async (
    action: CustomerCommandAction,
    payload: Record<string, unknown>,
  ) => {
    setError("");
    setNotice("");
    const commandId = crypto.randomUUID();
    const command: CustomerQueuedCommand = {
      id: commandId,
      workspaceId: workspaceId ?? "demo",
      action,
      payload,
      createdAt: new Date().toISOString(),
      attempts: 0,
    };

    setCustomers((current) => applyCommand(current, command));

    if (mode === "demo") {
      setNotice("Saved in this browser's local BDB OS preview.");
      return { ok: true };
    }
    if (!workspaceId) {
      setError("The current workspace is unavailable.");
      return { ok: false };
    }

    enqueueCustomerCommand(workspaceId, action, payload, commandId);
    setPendingCount(readCustomerQueue(workspaceId).length);
    if (!navigator.onLine) {
      setNotice("Saved offline. BDB OS will retry this Customer change when the connection returns.");
      return { ok: true };
    }

    try {
      await submitCustomerCommand(command);
      removeCustomerCommand(workspaceId, command.id);
      setPendingCount(readCustomerQueue(workspaceId).length);
      await loadCloud();
      setNotice(action === "create" ? "Customer created." : action === "update" ? "Customer updated." : action === "archive" ? "Customer archived." : "Customer restored.");
      return { ok: true };
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Customer change could not be saved.";
      const code = String((commandError as { code?: unknown })?.code ?? "");

      if (code) {
        removeCustomerCommand(workspaceId, command.id);
        setPendingCount(readCustomerQueue(workspaceId).length);
        await loadCloud().catch(() => undefined);
        if (code === "CUSTOMER_DUPLICATE_REVIEW") setDuplicateReview(true);
        setError(message);
        return { ok: false, code };
      }

      failCustomerCommand(workspaceId, command.id, message);
      setPendingCount(readCustomerQueue(workspaceId).length);
      setError(`${message} This Customer has not been confirmed by BDB OS yet; the change remains queued for retry.`);
      return { ok: false, code };
    }
  }, [loadCloud, mode, workspaceId]);

  const visibleCustomers = useMemo(() => {
    const term = query.trim().toLowerCase();
    return customers
      .filter((customer) => {
        const matchesQuery = !term || [
          customer.name,
          customer.code,
          customer.company,
          customer.email,
          customer.phone,
          customer.address,
          customer.vat_number,
          customer.legacy_id,
        ].join(" ").toLowerCase().includes(term);
        const matchesFilter = filter === "all"
          || (filter === "active" && customer.status === "active")
          || (filter === "archived" && customer.status === "archived")
          || (filter === "imported" && Boolean(customer.legacy_source));
        return matchesQuery && matchesFilter;
      })
      .sort((left, right) => left.name.localeCompare(right.name));
  }, [customers, filter, query]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setDuplicateReview(false);
    setFormOpen(true);
  }

  function openEdit(customer: CustomerRow) {
    setEditing(customer);
    setForm(formValues(customer));
    setDuplicateReview(false);
    setFormOpen(true);
  }

  async function persistCustomer(allowDuplicate: boolean) {
    if (saving || supportMode) return;
    setSaving(true);
    const isNewCustomer = !editing;
    const id = editing?.id ?? crypto.randomUUID();
    const result = await submitCommand(editing ? "update" : "create", {
      id,
      expectedVersion: editing?.version,
      code: form.code,
      name: form.name,
      company: form.company,
      email: form.email,
      phone: form.phone,
      address: form.address,
      vatNumber: form.vatNumber,
      preferences: form.preferences.trim() ? { summary: form.preferences.trim() } : {},
      allowDuplicate,
    });
    setSaving(false);
    if (!result.ok) return;
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm);
    setDuplicateReview(false);

    if (isNewCustomer && mode === "cloud" && navigator.onLine) {
      router.push(`/customers/${id}`);
    }
  }

  async function saveCustomer(event: FormEvent) {
    event.preventDefault();
    await persistCustomer(false);
  }

  async function changeStatus(customer: CustomerRow) {
    if (saving || supportMode || customer.pending) return;
    setSaving(true);
    await submitCommand(customer.status === "active" ? "archive" : "restore", {
      id: customer.id,
      expectedVersion: customer.version,
    });
    setSaving(false);
  }

  function discardQueue() {
    if (!workspaceId || workspaceId === "demo") return;
    writeCustomerQueue(workspaceId, []);
    setPendingCount(0);
    void loadCloud();
    setNotice("Pending local Customer changes were discarded.");
  }

  async function importSnapshot(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || importing || supportMode) return;
    if (mode !== "cloud" || !workspaceId) {
      setError("Vanita Customer import requires an active cloud workspace.");
      return;
    }
    if (!navigator.onLine) {
      setError("Vanita Customer import is online-only because duplicate and migration receipts must be checked atomically.");
      return;
    }
    if (file.size > 5_000_000) {
      setError("Choose a Vanita JSON snapshot smaller than 5 MB.");
      return;
    }

    setImporting(true);
    setError("");
    setNotice("");
    setImportResult(null);
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      const clients = extractVanitaClients(parsed);
      const batchId = crypto.randomUUID();
      const response = await fetch("/api/customers/import", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": batchId,
        },
        body: JSON.stringify({
          workspaceId,
          batchId,
          sourceSnapshotId: `${file.name}:${file.lastModified}:${clients.length}`,
          clients,
        }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Vanita Customers could not be imported.");
      const importSummary = result.result as ImportResult;
      setImportResult(importSummary);
      setNotice(`${importSummary.createdCount} created · ${importSummary.linkedCount} linked · ${importSummary.skippedCount} already imported · ${importSummary.errorCount} errors.`);
      await loadCloud();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Vanita Customers could not be imported.");
    } finally {
      setImporting(false);
    }
  }

  if (!loaded) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Customers…</main>;
  }

  const activeCustomers = customers.filter((customer) => customer.status === "active");
  const archivedCustomers = customers.filter((customer) => customer.status === "archived");
  const importedCustomers = customers.filter((customer) => Boolean(customer.legacy_source));

  return (
    <>
      <PageHeader
        eyebrow="Customer records"
        title="Customers"
        description="One authoritative Customer identity connected to Appointments, Sales, invoices, Documents, Communications and history."
        action={(
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <input ref={importInputRef} hidden type="file" accept="application/json,.json" onChange={(event) => void importSnapshot(event)} />
            <Button variant="secondary" disabled={supportMode || importing || mode !== "cloud"} onClick={() => importInputRef.current?.click()}>
              <FileUp size={17} /> {importing ? "Importing…" : "Import Vanita JSON"}
            </Button>
            <Button onClick={openCreate} disabled={supportMode}>
              <UserRoundPlus size={17} /> Add Customer
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <UsersRound size={19} />
        <div>
          <strong>Functional Customer foundation</strong>
          <p>Customer records now use audited commands, archive-based lifecycle control, offline retry, duplicate review and repeatable Vanita import receipts.</p>
        </div>
      </div>

      {error ? (
        <div className="review-callout">
          <TriangleAlert size={19} />
          <div><strong>Customers need attention</strong><p>{error}</p></div>
        </div>
      ) : null}

      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Customers updated</strong><p>{notice}</p></div> : null}

      {importResult?.exceptions?.length ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong>{importResult.errorCount} import exception{importResult.errorCount === 1 ? "" : "s"}</strong>
          <p>The batch completed without partial rows for failed records. Review the source indexes below and correct the snapshot before retrying.</p>
          <ul>{importResult.exceptions.slice(0, 10).map((item) => <li key={`${item.index}-${item.message}`}>Record {item.index}: {item.message}</li>)}</ul>
        </div>
      ) : null}

      {pendingCount > 0 ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong>{pendingCount} Customer change{pendingCount === 1 ? "" : "s"} waiting to sync</strong>
          <p>Commands retain stable retry keys. Synchronisation stops on the first conflict rather than overwriting another device.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <Button variant="secondary" disabled={syncing} onClick={() => void syncPending()}><RefreshCw size={16} className={syncing ? "spin" : ""} /> Retry</Button>
            <Button variant="quiet" onClick={discardQueue}>Discard local changes</Button>
          </div>
        </div>
      ) : null}

      {supportMode ? (
        <div className="settings-note" style={{ marginBottom: 18 }}>
          <strong>Read-only access</strong>
          <p>Customer changes and imports are blocked during this session.</p>
        </div>
      ) : null}

      <div className="stat-grid">
        <StatCard label="Active Customers" value={String(activeCustomers.length)} detail="Available for new work" icon={<UserRound size={19} />} />
        <StatCard label="Companies" value={String(new Set(activeCustomers.map((item) => item.company).filter(Boolean)).size)} detail="Connected organisations" icon={<Building2 size={19} />} />
        <StatCard label="Imported" value={String(importedCustomers.length)} detail="With Vanita provenance" icon={<FileUp size={19} />} />
        <StatCard label="Archived" value={String(archivedCustomers.length)} detail="Retained for history" icon={<Archive size={19} />} />
      </div>

      <Card className="table-card">
        <div className="toolbar">
          <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 240 }}>
            <Search size={17} />
            <input
              className="filter-input"
              style={{ width: "100%" }}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search name, code, company, email or phone…"
              aria-label="Search Customers"
            />
          </label>
          <div className="filter-tabs" role="group" aria-label="Filter Customers">
            {(["active", "archived", "imported", "all"] as CustomerFilter[]).map((item) => (
              <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                {item === "active" ? "Active" : item === "archived" ? "Archived" : item === "imported" ? "Imported" : "All"}
              </button>
            ))}
          </div>
          <Badge tone={pendingCount ? "gold" : "neutral"}>{visibleCustomers.length} Customers</Badge>
        </div>

        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Code</th>
                <th>Contact</th>
                <th>Address</th>
                <th>Source</th>
                <th>Status</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {visibleCustomers.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      <span className="result-icon"><UserRound size={17} /></span>
                      <span className="cell-stack">
                        <strong>{customer.name}</strong>
                        <span>{customer.company || "Individual Customer"}</span>
                        {customer.pending ? <small style={{ color: "var(--gold-light)" }}>Pending sync</small> : null}
                      </span>
                    </div>
                  </td>
                  <td><code>{customer.code}</code></td>
                  <td>
                    <span className="cell-stack">
                      <span><Mail size={13} style={{ display: "inline", marginRight: 5 }} />{customer.email || "No email"}</span>
                      <span><Phone size={13} style={{ display: "inline", marginRight: 5 }} />{customer.phone || "No phone"}</span>
                    </span>
                  </td>
                  <td>{customer.address || <span className="muted">—</span>}</td>
                  <td>{customer.legacy_source ? <Badge tone="blue">Vanita import</Badge> : <Badge tone="neutral">BDB OS</Badge>}</td>
                  <td><Badge tone={customer.status === "active" ? "green" : "neutral"}>{customer.status === "active" ? "Active" : "Archived"}</Badge></td>
                  <td>
                    <div className="table-actions">
                      <Button type="button" variant="quiet" disabled={supportMode || customer.pending} onClick={() => openEdit(customer)}>Edit</Button>
                      <Button type="button" variant="quiet" disabled={supportMode || customer.pending || saving} onClick={() => void changeStatus(customer)}>
                        {customer.status === "active" ? <><Archive size={15} /> Archive</> : <><Undo2 size={15} /> Restore</>}
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {visibleCustomers.length === 0 ? (
          <div className="card-pad"><h2>No Customers match</h2><p className="muted">Create a Customer, change the filter or import a reviewed Vanita JSON snapshot.</p></div>
        ) : null}
      </Card>

      <Dialog
        open={formOpen}
        onClose={() => { if (!saving) { setFormOpen(false); setDuplicateReview(false); } }}
        title={editing ? "Edit Customer" : "Add Customer"}
        description="Email is optional. Exact email or phone matches require an explicit duplicate decision. Operational notes are added from Customer 360."
      >
        <form onSubmit={(event) => void saveCustomer(event)}>
          <div className="form-grid">
            <div className="field"><label htmlFor="customer-name">Customer name</label><input id="customer-name" required maxLength={160} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
            <div className="field"><label htmlFor="customer-code">Customer code</label><input id="customer-code" maxLength={64} value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} placeholder="Generated when blank" /></div>
            <div className="field"><label htmlFor="customer-company">Company</label><input id="customer-company" maxLength={160} value={form.company} onChange={(event) => setForm({ ...form, company: event.target.value })} /></div>
            <div className="field"><label htmlFor="customer-vat-number">VAT number</label><input id="customer-vat-number" maxLength={64} value={form.vatNumber} onChange={(event) => setForm({ ...form, vatNumber: event.target.value })} placeholder="Optional" /></div>
            <div className="field"><label htmlFor="customer-email">Email</label><input id="customer-email" type="email" maxLength={320} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} placeholder="Optional" /></div>
            <div className="field"><label htmlFor="customer-phone">Phone</label><input id="customer-phone" maxLength={50} value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} placeholder="Optional" /></div>
            <div className="field field-full"><label htmlFor="customer-address">Address</label><textarea id="customer-address" maxLength={1000} value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></div>
            <div className="field field-full"><label htmlFor="customer-preferences">Preferences</label><textarea id="customer-preferences" maxLength={2000} value={form.preferences} onChange={(event) => setForm({ ...form, preferences: event.target.value })} placeholder="Service preferences or useful context" /></div>
          </div>

          {duplicateReview ? (
            <div className="review-callout" style={{ marginTop: 16 }}>
              <TriangleAlert size={18} />
              <div>
                <strong>Possible duplicate Customer</strong>
                <p>Review the existing directory first. Save anyway only when these are genuinely separate people or organisations sharing contact details.</p>
              </div>
            </div>
          ) : null}

          <div className="dialog-actions">
            <Button type="button" variant="quiet" disabled={saving} onClick={() => { setFormOpen(false); setDuplicateReview(false); }}>Cancel</Button>
            {duplicateReview ? <Button type="button" variant="secondary" disabled={saving} onClick={() => void persistCustomer(true)}>Save as separate Customer</Button> : null}
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : "Create Customer"}</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
