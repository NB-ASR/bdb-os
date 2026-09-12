"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
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
import { StandardDataImport } from "@/components/standard-data-import";
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
import {
  invalidateCustomerRegisterPages,
  readCustomerRegisterPage,
  writeCustomerRegisterPage,
  type CustomerRegisterPageMeta,
} from "@/lib/modules/customer-register-cache";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";

type CustomerStatus = "active" | "archived";
type CustomerFilter = "active" | "archived" | "review" | "all";
type CustomerReviewItem = {
  id: string;
  source_file: string;
  source_row: number;
  payload: Record<string, unknown>;
  issue_code: string;
  issue_message: string;
  created_at: string;
};

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
  needs_review?: boolean;
  created_at?: string;
  updated_at?: string;
  pending?: boolean;
};

type CustomerRegisterItem =
  | { rowKind: "customer"; id: string; customer: CustomerRow }
  | { rowKind: "import_review"; id: string; review: CustomerReviewItem };

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

type CustomerSummary = CachedCustomerSummary & { reviewCount?: number };

const PAGE_SIZE = 50;
const EMPTY_PAGE: CustomerRegisterPageMeta = {
  number: 1,
  limit: PAGE_SIZE,
  totalFiltered: 0,
  totalPages: 1,
  hasPrevious: false,
  hasNext: false,
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
  const email = payload.email ? String(payload.email) : null;
  const phone = payload.phone ? String(payload.phone) : null;
  return {
    id: String(payload.id),
    code: String(payload.code || `CUS-${String(payload.id).replaceAll("-", "").slice(-16).toUpperCase()}`),
    name: String(payload.name),
    company: String(payload.company ?? ""),
    email,
    phone,
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
    needs_review: !email && !phone,
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

function applyConfirmedCommand(customers: readonly CustomerRow[], command: CustomerQueuedCommand): CustomerRow[] {
  const customerId = String(command.payload.id);
  return applyCommand(customers, command).map((customer) => (
    customer.id === customerId ? { ...customer, pending: false } : customer
  ));
}

function applyConfirmedCommands(customers: readonly CustomerRow[], commands: readonly CustomerQueuedCommand[]) {
  return commands.reduce<CustomerRow[]>((current, command) => applyConfirmedCommand(current, command), [...customers]);
}

function dedupeCustomers(customers: readonly CustomerRow[]) {
  const rows = new Map<string, CustomerRow>();
  for (const customer of customers) rows.set(customer.id, customer);
  return [...rows.values()];
}

function matchesCustomerCriteria(customer: CustomerRow, query: string, filter: CustomerFilter) {
  if (filter === "review") return false;
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
    || (filter === "archived" && customer.status === "archived");
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

function reviewDisplayName(item: CustomerReviewItem) {
  const value = (keys: string[]) => keys.map((key) => item.payload[key]).find((entry) => String(entry ?? "").trim()) ?? "";
  return String(
    value(["name", "full_name", "customer_name", "client_name"])
    || [value(["first_name", "firstname", "given_name"]), value(["last_name", "lastname", "surname", "family_name"])].filter(Boolean).join(" ")
    || `Row ${item.source_row}`,
  );
}

function pagerTokens(totalPages: number, currentPage: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  const pages = new Set<number>([1, totalPages, currentPage - 1, currentPage, currentPage + 1]);
  if (currentPage <= 3) [2, 3, 4].forEach((page) => pages.add(page));
  if (currentPage >= totalPages - 2) [totalPages - 3, totalPages - 2, totalPages - 1].forEach((page) => pages.add(page));
  const ordered = [...pages].filter((page) => page >= 1 && page <= totalPages).sort((a, b) => a - b);
  const tokens: Array<number | "ellipsis"> = [];
  ordered.forEach((page, index) => {
    if (index > 0 && page - ordered[index - 1] > 1) tokens.push("ellipsis");
    tokens.push(page);
  });
  return tokens;
}

export default function CustomersPage() {
  const { mode } = useBdb();
  const router = useRouter();
  const requestSequence = useRef(0);
  const criteriaInitialised = useRef(false);
  const syncInFlight = useRef(false);
  const replayRequested = useRef(false);
  const [baseCustomers, setBaseCustomers] = useState<CustomerRow[]>([]);
  const [registerItems, setRegisterItems] = useState<CustomerRegisterItem[]>([]);
  const [registerPageExact, setRegisterPageExact] = useState(false);
  const [pageMeta, setPageMeta] = useState<CustomerRegisterPageMeta>(EMPTY_PAGE);
  const [queuedCommands, setQueuedCommands] = useState<CustomerQueuedCommand[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
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
  const [summary, setSummary] = useState<CustomerSummary | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [duplicateReview, setDuplicateReview] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerRow | null>(null);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteCommandId, setDeleteCommandId] = useState("");
  const [ownerRole, setOwnerRole] = useState("");
  const supportMode = false;

  const customers = useMemo(() => {
    if (mode === "demo") return baseCustomers;
    return queuedCommands.reduce(applyCommand, baseCustomers);
  }, [baseCustomers, mode, queuedCommands]);
  const pendingCount = queuedCommands.length;
  const ambiguousCount = queuedCommands.filter((command) => command.lastFailureKind === "ambiguous").length;

  const loadCachedRegisterPage = useCallback((
    currentWorkspaceId: string,
    targetFilter: CustomerFilter,
    targetSearch: string,
    targetPage: number,
  ) => {
    const cached = readCustomerRegisterPage<CustomerRegisterItem>(currentWorkspaceId, targetFilter, targetSearch, targetPage);
    if (!cached) return false;
    setRegisterItems(cached.items);
    setPageMeta(cached.meta);
    setRegisterPageExact(true);
    const cachedCustomers = cached.items.flatMap((item) => item.rowKind === "customer" ? [item.customer] : []);
    setBaseCustomers(cachedCustomers);
    setQueuedCommands(readCustomerQueue(currentWorkspaceId));
    setOffline(true);
    return true;
  }, []);

  const loadRegister = useCallback(async (
    currentWorkspaceId: string,
    options: {
      page?: number;
      search?: string;
      filter?: CustomerFilter;
      includeSummary?: boolean;
    } = {},
  ) => {
    const token = ++requestSequence.current;
    const targetPage = Math.max(1, options.page ?? 1);
    const targetSearch = options.search ?? "";
    const targetFilter = options.filter ?? "active";

    setLoadingPage(true);
    if (!navigator.onLine) {
      const found = loadCachedRegisterPage(currentWorkspaceId, targetFilter, targetSearch, targetPage);
      setLoadingPage(false);
      if (!found) throw new Error("That Customer page is not cached on this device. Reconnect to load it.");
      return true;
    }

    const params = new URLSearchParams({
      workspaceId: currentWorkspaceId,
      limit: String(PAGE_SIZE),
      page: String(targetPage),
      filter: targetFilter,
    });
    if (targetSearch.trim()) params.set("search", targetSearch.trim());
    if (options.includeSummary) params.set("summary", "1");

    let response: Response;
    try {
      response = await fetch(`/api/customers?${params.toString()}`, { cache: "no-store" });
    } catch (networkError) {
      const found = loadCachedRegisterPage(currentWorkspaceId, targetFilter, targetSearch, targetPage);
      setLoadingPage(false);
      if (found) return true;
      throw networkError;
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      if (token === requestSequence.current) setLoadingPage(false);
      throw new Error(result.error ?? "Customers could not be loaded.");
    }
    if (token !== requestSequence.current) return false;

    const items = (result.result?.items ?? []) as CustomerRegisterItem[];
    const meta = (result.result?.page ?? EMPTY_PAGE) as CustomerRegisterPageMeta;
    const pageCustomers = items.flatMap((item) => item.rowKind === "customer" ? [item.customer] : []);
    setRegisterItems(items);
    setBaseCustomers(pageCustomers);
    mergeCustomerCache(currentWorkspaceId, pageCustomers);
    setQueuedCommands(readCustomerQueue(currentWorkspaceId));
    setPageMeta(meta);
    setRegisterPageExact(true);
    writeCustomerRegisterPage(currentWorkspaceId, targetFilter, targetSearch, meta.number, items, meta);

    const cloudSummary = result.result?.summary as CustomerSummary | null | undefined;
    if (cloudSummary) {
      setSummary(cloudSummary);
      writeCustomerSummary(currentWorkspaceId, cloudSummary);
    }
    setOffline(false);
    setLoadingPage(false);
    return true;
  }, [loadCachedRegisterPage]);

  const reloadCurrent = useCallback(async (includeSummary = false) => {
    if (!workspaceId || workspaceId === "demo") return false;
    return loadRegister(workspaceId, { page: pageMeta.number, search: query, filter, includeSummary });
  }, [filter, loadRegister, pageMeta.number, query, workspaceId]);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const fallbackWorkspace = mode === "demo" ? "demo" : readLastCustomerWorkspace();
      const cachedCustomers = fallbackWorkspace ? readCustomerCache<CustomerRow>(fallbackWorkspace) : [];
      const queued = fallbackWorkspace && fallbackWorkspace !== "demo" ? readCustomerQueue(fallbackWorkspace) : [];
      const cachedSummary = fallbackWorkspace ? readCustomerSummary(fallbackWorkspace) : null;

      if (active && fallbackWorkspace) {
        setWorkspaceId(fallbackWorkspace);
        setBaseCustomers(cachedCustomers);
        setQueuedCommands(queued);
        setSummary(cachedSummary);
      }

      try {
        setError("");
        if (mode === "demo") {
          const demoItems = cachedCustomers.map((customer) => ({ rowKind: "customer", id: customer.id, customer }) as CustomerRegisterItem);
          setRegisterItems(demoItems);
          setPageMeta({ ...EMPTY_PAGE, totalFiltered: cachedCustomers.length });
          return;
        }
        if (!navigator.onLine) {
          setOffline(true);
          const exactPage = fallbackWorkspace ? loadCachedRegisterPage(fallbackWorkspace, "active", "", 1) : false;
          if (exactPage) {
            setNotice("Showing the last cached Active Customer page. Cached pages remain usable offline; uncached pages require a connection.");
          } else if (cachedCustomers.length || queued.length) {
            setRegisterItems(cachedCustomers.map((customer) => ({ rowKind: "customer", id: customer.id, customer }) as CustomerRegisterItem));
            setRegisterPageExact(false);
            setPageMeta({ ...EMPTY_PAGE, totalFiltered: cachedCustomers.length });
            setNotice("Showing the bounded offline Customer working set. It is not presented as the complete register; reconnect for uncached pages and import review items.");
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
        setOwnerRole(String(context.currentUser?.role ?? ""));
        rememberCustomerWorkspace(currentWorkspaceId);
        await loadRegister(currentWorkspaceId, { page: 1, search: "", filter: "active", includeSummary: true });
        if (active) setWorkspaceReady(true);
      } catch (initialError) {
        const message = initialError instanceof Error ? initialError.message : "Customers could not be loaded.";
        setOffline(true);
        if (cachedCustomers.length || queued.length) {
          if (active) {
            setRegisterItems(cachedCustomers.map((customer) => ({ rowKind: "customer", id: customer.id, customer }) as CustomerRegisterItem));
            setRegisterPageExact(false);
            setPageMeta({ ...EMPTY_PAGE, totalFiltered: cachedCustomers.length });
            setNotice("Showing the bounded offline Customer working set while cloud access is unavailable.");
          }
        } else if (active) {
          setError(message);
        }
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [loadCachedRegisterPage, loadRegister, mode]);

  useEffect(() => {
    if (mode === "demo" && loaded) {
      writeCustomerCache("demo", baseCustomers);
      writeCustomerSummary("demo", summaryFromRows(baseCustomers));
    }
  }, [baseCustomers, loaded, mode]);

  useEffect(() => {
    if (mode !== "cloud" || !loaded || !workspaceId) return;
    if (!criteriaInitialised.current) {
      criteriaInitialised.current = true;
      return;
    }
    const timer = window.setTimeout(() => {
      setError("");
      void loadRegister(workspaceId, { page: 1, search: query, filter }).catch((loadError) => {
        setError(loadError instanceof Error ? loadError.message : "Customers could not be loaded.");
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [filter, loadRegister, loaded, mode, query, workspaceId]);

  const syncPending = useCallback(async () => {
    if (!workspaceId || workspaceId === "demo") return;
    if (syncInFlight.current) {
      replayRequested.current = true;
      return;
    }
    if (!navigator.onLine) {
      setOffline(true);
      setNotice("Customer changes remain queued offline. No command was discarded or given a new retry key.");
      return;
    }

    syncInFlight.current = true;
    setSyncing(true);
    try {
      do {
        replayRequested.current = false;
        setError("");
        try {
          const queuedBeforeFlush = readCustomerQueue(workspaceId);
          const result = await flushCustomerQueue(workspaceId, () => setQueuedCommands(readCustomerQueue(workspaceId)));
          setQueuedCommands(readCustomerQueue(workspaceId));
          if (result.completed) {
            const completedCommands = queuedBeforeFlush.slice(0, result.completed);
            setBaseCustomers((current) => applyConfirmedCommands(current, completedCommands));
            writeCustomerCache(
              workspaceId,
              applyConfirmedCommands(readCustomerCache<CustomerRow>(workspaceId), completedCommands),
            );
            invalidateCustomerRegisterPages(workspaceId);
            setNotice(`${result.completed} queued Customer change${result.completed === 1 ? "" : "s"} synced with the original retry keys.`);
          }
          if (result.rejected) {
            setError(`${result.rejected.message} BDB OS confirmed that queued change was not applied; later queued changes were left untouched for review.`);
          } else if (result.ambiguous) {
            setError("BDB OS could not confirm the first queued Customer change. It remains queued with the same retry key so replay cannot duplicate an already-accepted command.");
          }
          await loadRegister(workspaceId, { page: pageMeta.number, search: query, filter, includeSummary: true });
        } catch (syncError) {
          setError(syncError instanceof Error ? syncError.message : "Customers could not be refreshed.");
        }
      } while (replayRequested.current && navigator.onLine);
    } finally {
      syncInFlight.current = false;
      setSyncing(false);
    }
  }, [filter, loadRegister, pageMeta.number, query, workspaceId]);

  useEffect(() => {
    if (mode !== "cloud") return;
    const handleOnline = () => {
      setOffline(false);
      replayRequested.current = true;
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
      return { ok: true, pending: false };
    }
    if (!workspaceId) {
      setError("The current workspace is unavailable.");
      return { ok: false, pending: false };
    }

    try {
      enqueueCustomerCommand(workspaceId, action, payload, commandId);
      setQueuedCommands(readCustomerQueue(workspaceId));
    } catch (queueError) {
      setError(queueError instanceof Error ? queueError.message : "The Customer offline queue is unavailable.");
      return { ok: false, pending: false };
    }

    if (!navigator.onLine) {
      setOffline(true);
      setNotice("Saved offline. BDB OS will replay this Customer change with the same retry key when the connection returns.");
      return { ok: true, pending: true };
    }

    try {
      await submitCustomerCommand(command);
    } catch (commandError) {
      const message = commandError instanceof Error ? commandError.message : "Customer change could not be saved.";
      const code = commandError instanceof CustomerSubmitError ? commandError.code : "";

      if (commandError instanceof CustomerSubmitError && commandError.confirmedRejected) {
        removeCustomerCommand(workspaceId, command.id);
        setQueuedCommands(readCustomerQueue(workspaceId));
        await loadRegister(workspaceId, { page: pageMeta.number, search: query, filter, includeSummary: true }).catch(() => undefined);
        if (code === "CUSTOMER_DUPLICATE_REVIEW") setDuplicateReview(true);
        setError(message);
        return { ok: false, pending: false, code };
      }

      failCustomerCommand(workspaceId, command.id, message, "ambiguous");
      setQueuedCommands(readCustomerQueue(workspaceId));
      setError(`${message} BDB OS did not receive a confirmed outcome, so the change remains queued with the same retry key.`);
      return { ok: true, pending: true, code };
    }

    removeCustomerCommand(workspaceId, command.id);
    setQueuedCommands(readCustomerQueue(workspaceId));
    setBaseCustomers((current) => applyConfirmedCommand(current, command));
    writeCustomerCache(workspaceId, applyConfirmedCommand(readCustomerCache<CustomerRow>(workspaceId), command));
    invalidateCustomerRegisterPages(workspaceId);

    const successNotice = action === "create"
      ? "Customer created."
      : action === "update"
        ? "Customer updated."
        : action === "archive"
          ? "Customer archived."
          : "Customer restored.";
    setNotice(successNotice);
    try {
      await loadRegister(workspaceId, { page: pageMeta.number, search: query, filter, includeSummary: true });
    } catch (refreshError) {
      setError(`The Customer change was saved, but the register could not refresh: ${refreshError instanceof Error ? refreshError.message : "refresh failed"}.`);
    }
    return { ok: true, pending: false };
  }, [filter, loadRegister, mode, pageMeta.number, query, workspaceId]);

  const customerById = useMemo(() => new Map(customers.map((customer) => [customer.id, customer])), [customers]);
  const displayedItems = useMemo(() => {
    if (mode === "demo") {
      return customers
        .filter((customer) => matchesCustomerCriteria(customer, query, filter))
        .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id))
        .map((customer) => ({ rowKind: "customer", id: customer.id, customer }) as CustomerRegisterItem);
    }

    const current = registerItems.flatMap((item) => {
      if (item.rowKind === "import_review") return [item];
      const customer = customerById.get(item.id) ?? item.customer;
      return matchesCustomerCriteria(customer, query, filter) ? [{ ...item, customer } as CustomerRegisterItem] : [];
    });
    if (filter === "review" || pageMeta.number !== 1) return current;

    const presentIds = new Set(current.map((item) => item.id));
    const pendingExtras = customers
      .filter((customer) => customer.pending && !presentIds.has(customer.id) && matchesCustomerCriteria(customer, query, filter))
      .map((customer) => ({ rowKind: "customer", id: customer.id, customer }) as CustomerRegisterItem);
    return [...pendingExtras, ...current];
  }, [customerById, customers, filter, mode, pageMeta.number, query, registerItems]);

  const displayedSummary = mode === "demo" ? summaryFromRows(customers) : (summary ?? summaryFromRows(customers));
  const pageTokens = useMemo(() => pagerTokens(pageMeta.totalPages, pageMeta.number), [pageMeta.number, pageMeta.totalPages]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setDuplicateReview(false);
    setReviewingId(null);
    setFormOpen(true);
  }

  function openEdit(customer: CustomerRow) {
    setEditing(customer);
    setForm(formValues(customer));
    setDuplicateReview(false);
    setReviewingId(null);
    setFormOpen(true);
  }

  function openReview(item: CustomerReviewItem) {
    if (offline) return;
    const value = (keys: string[]) => keys.map((key) => item.payload[key]).find((entry) => String(entry ?? "").trim()) ?? "";
    const fullName = value(["name", "full_name", "customer_name", "client_name"])
      || [value(["first_name", "firstname", "given_name"]), value(["last_name", "lastname", "surname", "family_name"])].filter(Boolean).join(" ");
    setEditing(null);
    setReviewingId(item.id);
    setForm({
      code: String(value(["code", "customer_code", "client_code"])),
      name: String(fullName),
      company: String(value(["company", "business", "organisation", "organization"])),
      email: String(value(["email", "email_address"])),
      phone: String(value(["phone", "phone_number", "mobile", "mobile_number"])),
      address: String(value(["address", "postal_address", "street_address"])),
      vatNumber: String(value(["vatNumber", "vat_number", "vat", "tax_number"])),
      preferences: "",
    });
    setDuplicateReview(item.issue_code === "CUSTOMER_DUPLICATE_REVIEW");
    setFormOpen(true);
  }

  async function resolveReview(reviewId: string, action: "resolve" | "dismiss") {
    if (!workspaceId || offline || !navigator.onLine) throw new Error("Import review changes require a connection.");
    const response = await fetch("/api/customers/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
      body: JSON.stringify({ workspaceId, action, reviewId }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Review item could not be updated.");
    invalidateCustomerRegisterPages(workspaceId);
    try {
      await loadRegister(workspaceId, { page: pageMeta.number, search: query, filter, includeSummary: true });
    } catch (refreshError) {
      throw new Error(`The import review was ${action === "resolve" ? "resolved" : "dismissed"}, but the register could not refresh: ${refreshError instanceof Error ? refreshError.message : "refresh failed"}.`);
    }
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
    if (reviewingId && !result.pending) {
      try {
        await resolveReview(reviewingId, "resolve");
        setReviewingId(null);
      } catch (reviewError) {
        setError(reviewError instanceof Error ? reviewError.message : "The review item could not be closed.");
      }
    }

    if (isNewCustomer && mode === "cloud" && navigator.onLine && !result.pending && !reviewingId) {
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

  async function goToCustomerPage(targetPage: number) {
    if (!workspaceId || workspaceId === "demo" || loadingPage) return;
    const boundedPage = Math.max(1, Math.min(targetPage, pageMeta.totalPages));
    if (boundedPage === pageMeta.number) return;
    setError("");
    try {
      await loadRegister(workspaceId, { page: boundedPage, search: query, filter });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The Customer page could not be loaded.");
    }
  }

  async function deleteCustomer() {
    if (!workspaceId || !deleteTarget || saving) return;
    setSaving(true);
    setError("");
    const response = await fetch("/api/customers/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Idempotency-Key": deleteCommandId || crypto.randomUUID() },
      body: JSON.stringify({
        workspaceId,
        customerId: deleteTarget.id,
        expectedVersion: deleteTarget.version,
        email: deleteEmail,
        password: deletePassword,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setSaving(false);
    if (!response.ok || !result.ok) {
      setError(result.error ?? "Customer could not be deleted.");
      return;
    }
    const deletedId = deleteTarget.id;
    invalidateCustomerRegisterPages(workspaceId);
    setBaseCustomers((current) => current.filter((customer) => customer.id !== deletedId));
    setRegisterItems((current) => current.filter((item) => item.rowKind !== "customer" || item.id !== deletedId));
    writeCustomerCache(
      workspaceId,
      readCustomerCache<CustomerRow>(workspaceId).filter((customer) => customer.id !== deletedId),
    );
    setDeleteTarget(null);
    setDeleteEmail("");
    setDeletePassword("");
    setDeleteCommandId("");
    setNotice("Customer permanently deleted.");
    try {
      await reloadCurrent(true);
    } catch (refreshError) {
      setError(`The Customer was permanently deleted, but the register could not refresh: ${refreshError instanceof Error ? refreshError.message : "refresh failed"}.`);
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
            <StandardDataImport
              entity="customers"
              workspaceId={workspaceId}
              disabled={supportMode || mode !== "cloud" || offline || !workspaceReady}
              onImported={() => {
                if (workspaceId && workspaceId !== "demo") invalidateCustomerRegisterPages(workspaceId);
                return reloadCurrent(true);
              }}
            />
            <Button onClick={openCreate} disabled={supportMode}>
              <UserRoundPlus size={17} /> Add Customer
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <UsersRound size={19} />
        <div>
          <strong>Connected Customer register</strong>
          <p>Cloud search and filters use 50-row pages with direct navigation. Review contains unresolved import exceptions only; All includes active and archived Customers plus those pending import exceptions.</p>
        </div>
      </div>

      {error ? (
        <div className="review-callout">
          <TriangleAlert size={19} />
          <div><strong>Customers need attention</strong><p>{error}</p></div>
        </div>
      ) : null}

      {notice ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Customers updated</strong><p>{notice}</p></div> : null}

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
        <StatCard label="Imported" value={String(displayedSummary.importedCount)} detail={offline ? "Last synced total" : "With imported provenance"} icon={<FileUp size={19} />} />
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
            {(["active", "archived", "review", "all"] as CustomerFilter[]).map((item) => (
              <button key={item} className={filter === item ? "active" : ""} onClick={() => setFilter(item)}>
                {item === "active" ? "Active" : item === "archived" ? "Archived" : item === "review" ? "Review" : "All"}
              </button>
            ))}
          </div>
          <Badge tone={pendingCount ? "gold" : "neutral"}>
            {offline
              ? registerPageExact ? `Cached page ${pageMeta.number} of ${pageMeta.totalPages}` : `${displayedItems.length} cached`
              : `${pageMeta.totalFiltered.toLocaleString()} result${pageMeta.totalFiltered === 1 ? "" : "s"}`}
          </Badge>
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
              {displayedItems.map((item) => {
                if (item.rowKind === "import_review") {
                  const review = item.review;
                  return (
                    <tr key={`review:${review.id}`}>
                      <td><span className="cell-stack"><strong>{reviewDisplayName(review)}</strong><span>{review.source_file} · row {review.source_row}</span></span></td>
                      <td><Badge tone="gold">Import review</Badge></td>
                      <td>{String(review.payload.email || review.payload.phone || review.payload.mobile || "No contact detail")}</td>
                      <td colSpan={2}>{review.issue_message}</td>
                      <td><Badge tone="gold">Needs review</Badge></td>
                      <td>
                        <div className="table-actions">
                          <Button type="button" variant="quiet" disabled={offline} onClick={() => openReview(review)}>Review</Button>
                          <Button type="button" variant="quiet" disabled={offline} onClick={() => void resolveReview(review.id, "dismiss").catch((reviewError) => setError(reviewError instanceof Error ? reviewError.message : "Review item could not be dismissed."))}>Dismiss</Button>
                        </div>
                      </td>
                    </tr>
                  );
                }

                const customer = item.customer;
                return (
                  <tr key={`customer:${customer.id}`}>
                    <td>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="result-icon"><UserRound size={17} /></span>
                        <span className="cell-stack">
                          <strong>{customer.name}</strong>
                          <span>{customer.company || "Individual Customer"}</span>
                          {customer.needs_review ? <small style={{ color: "var(--gold-light)" }}>Incomplete details</small> : null}
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
                    <td>{customer.legacy_source ? <Badge tone="blue">Imported</Badge> : <Badge tone="neutral">BDB OS</Badge>}</td>
                    <td>
                      <span className="cell-stack">
                        <Badge tone={customer.status === "active" ? "green" : "neutral"}>{customer.status === "active" ? "Active" : "Archived"}</Badge>
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        <Button type="button" variant="quiet" disabled={supportMode || customer.pending} onClick={() => openEdit(customer)}>Edit</Button>
                        <Button type="button" variant="quiet" disabled={supportMode || customer.pending || saving} onClick={() => void changeStatus(customer)}>
                          {customer.status === "active" ? <><Archive size={15} /> Archive</> : <><Undo2 size={15} /> Restore</>}
                        </Button>
                        {customer.status === "archived" && ownerRole === "owner" ? (
                          <Button type="button" variant="quiet" disabled={customer.pending || saving || offline} onClick={() => {
                            setError("");
                            setDeleteTarget(customer);
                            setDeleteEmail("");
                            setDeletePassword("");
                            setDeleteCommandId(crypto.randomUUID());
                          }}>Delete</Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {loadingPage ? <div className="card-pad"><p className="muted"><RefreshCw className="spin" size={15} style={{ display: "inline", marginRight: 6 }} />Loading Customer page…</p></div> : null}
        {!loadingPage && displayedItems.length === 0 ? (
          <div className="card-pad">
            <h2>{filter === "review" ? "No imports need review" : "No Customers match"}</h2>
            <p className="muted">{filter === "review" ? "Rows that cannot safely become Customers will appear here until reviewed or dismissed." : "Create a Customer, change the filter or import a standard Customer CSV or Excel file."}</p>
          </div>
        ) : null}

        {mode === "cloud" && registerPageExact && pageMeta.totalPages > 1 ? (
          <div className="card-pad" style={{ display: "flex", justifyContent: "center", alignItems: "center", flexWrap: "wrap", gap: 8 }} aria-label="Customer page navigation">
            <Button type="button" variant="secondary" aria-label="First Customer page" disabled={loadingPage || pageMeta.number === 1} onClick={() => void goToCustomerPage(1)}>«</Button>
            <Button type="button" variant="secondary" aria-label="Previous Customer page" disabled={loadingPage || !pageMeta.hasPrevious} onClick={() => void goToCustomerPage(pageMeta.number - 1)}>‹</Button>
            {pageTokens.map((token, index) => token === "ellipsis" ? (
              <span key={`ellipsis-${index}`} className="muted" aria-hidden="true">…</span>
            ) : (
              <Button
                key={token}
                type="button"
                variant={token === pageMeta.number ? "primary" : "secondary"}
                aria-current={token === pageMeta.number ? "page" : undefined}
                aria-label={`Customer page ${token}`}
                disabled={loadingPage || token === pageMeta.number}
                onClick={() => void goToCustomerPage(token)}
              >{token}</Button>
            ))}
            <Button type="button" variant="secondary" aria-label="Next Customer page" disabled={loadingPage || !pageMeta.hasNext} onClick={() => void goToCustomerPage(pageMeta.number + 1)}>›</Button>
            <Button type="button" variant="secondary" aria-label="Last Customer page" disabled={loadingPage || pageMeta.number === pageMeta.totalPages} onClick={() => void goToCustomerPage(pageMeta.totalPages)}>»</Button>
          </div>
        ) : null}
      </Card>

      <Dialog
        open={formOpen}
        onClose={() => { if (!saving) { setFormOpen(false); setDuplicateReview(false); setReviewingId(null); } }}
        title={editing ? "Edit Customer" : reviewingId ? "Review imported Customer" : "Add Customer"}
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
            <Button type="button" variant="quiet" disabled={saving} onClick={() => { setFormOpen(false); setDuplicateReview(false); setReviewingId(null); }}>Cancel</Button>
            {duplicateReview ? <Button type="button" variant="secondary" disabled={saving} onClick={() => void persistCustomer(true)}>Save as separate Customer</Button> : null}
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : editing ? "Save changes" : reviewingId ? "Create Customer & resolve" : "Create Customer"}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog
        open={Boolean(deleteTarget)}
        onClose={() => { if (!saving) { setDeleteTarget(null); setDeletePassword(""); setDeleteCommandId(""); } }}
        title="Permanently delete Customer"
        description="This cannot be undone. Customers with linked business history cannot be deleted and must remain archived."
      >
        {error ? <div className="review-callout"><TriangleAlert size={18} /><div><strong>Deletion blocked</strong><p>{error}</p></div></div> : null}
        <div className="form-grid">
          <div className="field field-full"><label htmlFor="delete-owner-email">Signed-in owner email</label><input id="delete-owner-email" type="email" autoComplete="username" value={deleteEmail} onChange={(event) => setDeleteEmail(event.target.value)} /></div>
          <div className="field field-full"><label htmlFor="delete-owner-password">Current password</label><input id="delete-owner-password" type="password" autoComplete="current-password" value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} /></div>
        </div>
        <div className="dialog-actions">
          <Button type="button" variant="quiet" disabled={saving} onClick={() => { setDeleteTarget(null); setDeleteCommandId(""); }}>Cancel</Button>
          <Button type="button" disabled={saving || !deleteEmail.trim() || !deletePassword} onClick={() => void deleteCustomer()}>{saving ? "Verifying…" : "Permanently delete"}</Button>
        </div>
      </Dialog>
    </>
  );
}
