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
  CustomerSubmitError,
  type CustomerCommandAction,
  type CustomerQueuedCommand,
} from "@/lib/modules/customer-queue";
import {
  mergeCustomerCache,
  readCustomerCache,
  readCustomerSummary,
  readLastCustomerWorkspace,
  rememberCustomerWorkspace,
  writeCustomerCache,
  writeCustomerSummary,
  type CachedCustomerSummary,
} from "@/lib/modules/customer-cache";
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

type CustomerCursor = { name: string; id: string };
type CustomerSummary = CachedCustomerSummary;

const PAGE_SIZE = 100;
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

function dedupeCustomers(customers: readonly CustomerRow[]) {
  const rows = new Map<string, CustomerRow>();
  for (const customer of customers) rows.set(customer.id, customer);
  return [...rows.values()];
}

function matchesCriteria(customer: CustomerRow, query: string, filter: CustomerFilter) {
  const term = query.trim().toLowerCase();
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
}

function summaryFromRows(customers: readonly CustomerRow[]): CustomerSummary {
  return {
    activeCount: customers.filter((customer) => customer.status === "active").length,
    archivedCount: customers.filter((customer) => customer.status === "archived").length,
    importedCount: customers.filter((customer) => Boolean(customer.legacy_source)).length,
    companyCount: new Set(customers.map((customer) => customer.company).filter(Boolean)).size,
  };
}

export default function CustomersPage() {
  const { mode } = useBdb();
  const router = useRouter();
  const importInputRef = useRef<HTMLInputElement>(null);
  const requestSequence = useRef(0);
  const criteriaInitialised = useRef(false);
  const [baseCustomers, setBaseCustomers] = useState<CustomerRow[]>([]);
  const [queuedCommands, setQueuedCommands] = useState<CustomerQueuedCommand[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [offline, setOffline] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRow | null>(null);
  const [form, setForm] = useState<CustomerForm>(emptyForm);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<CustomerFilter>("active");
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadingPage, setLoadingPage] = useState(false);
  const [importing, setImporting] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<CustomerCursor | null>(null);
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [duplicateReview, setDuplicateReview] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const supportMode = false;

  const customers = useMemo(() => {
    if (mode === "demo") return baseCustomers;
    return queuedCommands.reduce(applyCommand, baseCustomers);
  }, [baseCustomers, mode, queuedCommands]);
  const pendingCount = queuedCommands.length;
  const ambiguousCount = queuedCommands.filter((command) => command.lastFailureKind === "ambiguous").length;

  const loadRegister = useCallback(async (
    currentWorkspaceId: string,
    options: {
      append?: boolean;
      cursor?: CustomerCursor | null;
      search?: string;
      filter?: CustomerFilter;
      includeSummary?: boolean;
    } = {},
  ) => {
    const token = ++requestSequence.current;
    const append = options.append === true;
    const params = new URLSearchParams({
      workspaceId: currentWorkspaceId,
      limit: String(PAGE_SIZE),
      filter: options.filter ?? "active",
    });
    if (options.search?.trim()) params.set("search", options.search.trim());
    if (options.cursor) {
      params.set("afterName", options.cursor.name);
      params.set("afterId", options.cursor.id);
    }
    if (options.includeSummary) params.set("summary", "1");

    setLoadingPage(true);
    const response = await fetch(`/api/customers?${params.toString()}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      if (token === requestSequence.current) setLoadingPage(false);
      throw new Error(result.error ?? "Customers could not be loaded.");
    }
    if (token !== requestSequence.current) return false;

    const pageCustomers = (result.result?.customers ?? []) as CustomerRow[];
    setBaseCustomers((current) => append ? dedupeCustomers([...current, ...pageCustomers]) : pageCustomers);
    mergeCustomerCache(currentWorkspaceId, pageCustomers);
    setQueuedCommands(readCustomerQueue(currentWorkspaceId));
    setHasMore(Boolean(result.result?.page?.hasMore));
    const cursor = result.result?.page?.nextCursor as CustomerCursor | null | undefined;
    setNextCursor(cursor?.name && cursor?.id ? cursor : null);

    const cloudSummary = result.result?.summary as CustomerSummary | null | undefined;
    if (cloudSummary) {
      setSummary(cloudSummary);
      writeCustomerSummary(currentWorkspaceId, cloudSummary);
    }
    setOffline(false);
    setLoadingPage(false);
    return true;
  }, []);

  const reloadCurrent = useCallback(async (includeSummary = false) => {
    if (!workspaceId || workspaceId === "demo") return false;
    return loadRegister(workspaceId, { search: query, filter, includeSummary });
  }, [filter, loadRegister, query, workspaceId]);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastCustomerWorkspace();
      const cached = fallbackWorkspace ? readCustomerCache<CustomerRow>(fallbackWorkspace) : [];
      const queued = fallbackWorkspace && fallbackWorkspace !== "demo" ? readCustomerQueue(fallbackWorkspace) : [];
      const cachedSummary = fallbackWorkspace ? readCustomerSummary(fallbackWorkspace) : null;

      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        setBaseCustomers(cached);
        setQueuedCommands(queued);
        setSummary(cachedSummary);
      }

      try {
        setError("");
        if (mode === "demo") return;
        if (!navigator.onLine) {
          setOffline(true);
          if (cached.length || queued.length) {
            setNotice("Showing the bounded offline Customer working set. Pending changes keep their stable retry keys until BDB OS confirms the server outcome.");
          } else {
            setError("Customers need one successful online load before this workspace can open from a cold offline start.");
          }
          return;
        }

        const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
        const context = await contextResponse.json().catch(() => ({}));
        if (!contextResponse.ok || !context.currentWorkspaceId) {
          throw new Error(context.error ?? "The current workspace could not be resolved.");
        }
        const currentWorkspaceId = String(context.currentWorkspaceId);
        if (!active) return;
        setWorkspaceId(currentWorkspaceId);
        rememberCustomerWorkspace(currentWorkspaceId);
        await loadRegister(currentWorkspaceId, { search: "", filter: "active", includeSummary: true });
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Customers could not be loaded.";
        setOffline(true);
        if (cached.length || queued.length) {
          if (active) setNotice("Showing the bounded offline Customer working set while cloud access is unavailable.");
        } else if (active) {
          setError(message);
        }
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [loadRegister, mode]);

  useEffect(() => {
    if (mode === "demo" && loaded) {
      writeCustomerCache("demo", baseCustomers);
      const demoSummary = summaryFromRows(baseCustomers);
      setSummary(demoSummary);
      writeCustomerSummary("demo", demoSummary);
    }
  }, [baseCustomers, loaded, mode]);

  useEffect(() => {
    if (mode !== "cloud" || !loaded || !workspaceId || offline) return;
    if (!criteriaInitialised.current) {
      criteriaInitialised.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      setError("");
      void loadRegister(workspaceId, { search: query, filter }).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Customers could not be loaded.");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filter, loadRegister, loaded, mode, offline, query, workspaceId]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo" || syncing) return;
    if (!navigator.onLine) {
      setOffline(true);
      setNotice("Customer changes remain queued offline. No command was discarded or given a new retry key.");
      return;
    }

    setSyncing(true);
    setError("");
    try {
      const result = await flushCustomerQueue(workspaceId, () => setQueuedCommands(readCustomerQueue(workspaceId)));
      setQueuedCommands(readCustomerQueue(workspaceId));
      if (result.completed) {
        setNotice(`${result.completed} queued Customer change${result.completed === 1 ? "" : "s"} synced with the original retry keys.`);
      }
      if (result.rejected) {
        setError(`${result.rejected.message} BDB OS confirmed that queued change was not applied; later queued changes were left untouched for review.`);
      } else if (result.ambiguous) {
        setError("BDB OS could not confirm the first queued Customer change. It remains queued with the same retry key so replay cannot duplicate an already-accepted command.");
      }
      await loadRegister(workspaceId, { search: query, filter, includeSummary: true });
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Customers could not be refreshed.");
    } finally {
      setSyncing(false);
    }
  }, [filter, loadRegister, query, syncing, workspaceId]);

  useEffect(() => {
    if (mode !== "cloud") return;
    const handleOnline = () => {
      setOffline(false);
      void syncPending();
    };
    const handleOffline = () => setOffline(true);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
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

    if (mode === "demo") {
      setBaseCustomers((current) => applyCommand(current, command).map((customer) => ({ ...customer, pending: false })));
      setNotice("Saved in this browser's local BDB OS preview.");
      return { ok: true };
    }
    if (!workspaceId) {
      setError("The current workspace is unavailable.");
      return { ok: false };
    }

    try {
      enqueueCustomerCommand(workspaceId, action, payload, commandId);
      setQueuedCommands(readCustomerQueue(workspaceId));
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : "The Customer offline queue is unavailable.");
      return { ok: false };
    }

    if (!navigator.onLine) {
      setOffline(true);
      setNotice("Saved offline. BDB OS will replay this Customer change with the same retry key when the connection returns.");
      return { ok: true };
    }

    try {
      await submitCustomerCommand(command);
      removeCustomerCommand(workspaceId, command.id);
      setQueuedCommands(readCustomerQueue(workspaceId));
      await loadRegister(workspaceId, { search: query, filter, includeSummary: true });
      setNotice(action === "create" ? "Customer created." : action === "update" ? "Customer updated." : action === "archive" ? "Customer archived." : "Customer restored.");
      return { ok: true };
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Customer change could not be saved.";
      const code = commandError instanceof CustomerSubmitError ? commandError.code : "";

      if (commandError instanceof CustomerSubmitError && commandError.confirmedRejected) {
        removeCustomerCommand(workspaceId, command.id);
        setQueuedCommands(readCustomerQueue(workspaceId));
        await loadRegister(workspaceId, { search: query, filter, includeSummary: true }).catch(() => undefined);
        if (code === "CUSTOMER_DUPLICATE_REVIEW") setDuplicateReview(true);
        setError(message);
        return { ok: false, code };
      }

      failCustomerCommand(workspaceId, command.id, message, "ambiguous");
      setQueuedCommands(readCustomerQueue(workspaceId));
      setError(`${message} BDB OS did not receive a confirmed outcome, so the change remains queued with the same retry key.`);
      return { ok: false, code };
    }
  }, [filter, loadRegister, mode, query, workspaceId]);

  const visibleCustomers = useMemo(() => customers
    .filter((customer) => matchesCriteria(customer, query, filter))
    .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id)), [customers, filter, query]);

  const displayedSummary = summary ?? summaryFromRows(customers);

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

  async function loadMoreCustomers() {
    if (!workspaceId || workspaceId === "demo" || !nextCursor || loadingPage || offline) return;
    setError("");
    await loadRegister(workspaceId, {
      append: true,
      cursor: nextCursor,
      search: query,
      filter,
    }).catch((loadError) => {
      setError(loadError instanceof Error ? loadError.message : "More Customers could not be loaded.");
    });
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
      await reloadCurrent(true);
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "Vanita Customers could not be imported.");
    } finally {
      setImporting(false);
    }
  }

  if (!loaded) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Customers…</main>;
  }

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
          <strong>Bounded Customer register</strong>
          <p>Cloud search and filters use 100-row keyset pages. Offline mode keeps a bounded working set while pending commands retain stable retry keys.</p>
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
          <p>{ambiguousCount ? `${ambiguousCount} change${ambiguousCount === 1 ? " has" : "s have"} an unconfirmed server outcome. ` : ""}BDB OS preserves the original retry key and never offers a blanket discard for an ambiguous command.</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
            <Button variant="secondary" disabled={syncing || offline} onClick={() => void syncPending()}><RefreshCw size={16} className={syncing ? "spin" : ""} /> Retry safely</Button>
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
        <StatCard label="Active Customers" value={String(displayedSummary.activeCount)} detail={offline ? "Last synced total" : "Available for new work"} icon={<UserRound size={19} />} />
        <StatCard label="Companies" value={String(displayedSummary.companyCount)} detail={offline ? "Last synced total" : "Connected organisations"} icon={<Building2 size={19} />} />
        <StatCard label="Imported" value={String(displayedSummary.importedCount)} detail={offline ? "Last synced total" : "With Vanita provenance"} icon={<FileUp size={19} />} />
        <StatCard label="Archived" value={String(displayedSummary.archivedCount)} detail={offline ? "Last synced total" : "Retained for history"} icon={<Archive size={19} />} />
      </div>

      <Card className="table-card">
        <div className="toolbar">
          <label style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 240 }}>
            <Search size={17} />
            <input
              className="filter-input"
              style={{ width: "100%" }}
              value={query}
              maxLength={120}
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
          <Badge tone={pendingCount ? "gold" : "neutral"}>{visibleCustomers.length}{hasMore && !offline ? "+" : ""} loaded</Badge>
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

        {loadingPage ? <div className="card-pad"><p className="muted"><RefreshCw className="spin" size={15} style={{ display: "inline", marginRight: 6 }} />Loading Customer page…</p></div> : null}
        {!loadingPage && visibleCustomers.length === 0 ? (
          <div className="card-pad"><h2>No Customers match</h2><p className="muted">Create a Customer, change the filter or import a reviewed Vanita JSON snapshot.</p></div>
        ) : null}
        {hasMore && !offline && mode === "cloud" ? (
          <div className="card-pad" style={{ display: "flex", justifyContent: "center" }}>
            <Button type="button" variant="secondary" disabled={loadingPage} onClick={() => void loadMoreCustomers()}>
              {loadingPage ? "Loading…" : `Load next ${PAGE_SIZE}`}
            </Button>
          </div>
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
