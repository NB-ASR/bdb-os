"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { seedState } from "./seed";
import type {
  Automation,
  BdbState,
  Booking,
  BusinessDocument,
  BusinessSettings,
  Customer,
  Invoice,
  Message,
  WorkspaceTheme,
} from "./types";
import {
  cloudInsert,
  cloudUpdate,
  cloudUpsert,
  createWorkspaceInvoice,
  loadCloudWorkspace,
  reconcileWorkspaceTransaction,
  removeWorkspaceDocument,
  uploadWorkspaceDocument,
  uploadWorkspaceLogo,
} from "./cloud-store";

const STORAGE_KEY = "bdb-os-state-v1";

type NewCustomer = Omit<Customer, "id" | "code" | "createdAt">;
type NewInvoice = Omit<Invoice, "id" | "number" | "issuedAt">;
type NewBooking = Omit<Booking, "id">;
type NewMessage = Omit<Message, "id" | "timestamp" | "unread" | "status">;
type NewDocument = Omit<BusinessDocument, "id" | "uploadedAt">;
export type SyncStatus = "idle" | "saving" | "saved" | "error" | "offline";
type MutationResult = Promise<boolean>;

interface StoreValue {
  state: BdbState;
  ready: boolean;
  mode: "demo" | "cloud";
  workspaceId: string | null;
  role: string;
  syncStatus: SyncStatus;
  lastError: string | null;
  clearError: () => void;
  addCustomer: (customer: NewCustomer) => MutationResult;
  addInvoice: (invoice: NewInvoice) => MutationResult;
  markInvoicePaid: (id: string) => MutationResult;
  addBooking: (booking: NewBooking) => MutationResult;
  sendMessage: (message: NewMessage) => MutationResult;
  markMessageRead: (id: string) => MutationResult;
  dismissMessageDraft: (id: string) => MutationResult;
  addDocument: (document: NewDocument, file?: File) => MutationResult;
  reconcileTransaction: (transactionId: string, invoiceId?: string) => MutationResult;
  toggleAutomation: (id: string) => MutationResult;
  updateSettings: (settings: BusinessSettings) => MutationResult;
  updateTheme: (theme: WorkspaceTheme) => MutationResult;
  uploadLogo: (file: File) => MutationResult;
  resetDemo: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${prefix}-${Date.now()}`;
}

function addActivity(
  state: BdbState,
  action: string,
  detail: string,
  tone: "gold" | "green" | "blue" | "neutral" = "gold",
) {
  return [
    { id: makeId("act"), action, detail, timestamp: new Date().toISOString(), tone },
    ...state.activity,
  ];
}

export function BdbProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BdbState>(seedState);
  const stateRef = useRef(state);
  const [ready, setReady] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [role, setRole] = useState("owner");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("idle");

  useEffect(() => { stateRef.current = state; }, [state]);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const cloudConfigured = isSupabaseConfigured();
      try {
        const cloud = await loadCloudWorkspace();
        if (!active) return;
        if (cloud) {
          setState(cloud.state);
          setWorkspaceId(cloud.workspaceId);
          setRole(cloud.role);
          setSyncStatus("saved");
        } else if (cloudConfigured) {
          setLoadError("Your account is signed in, but no active workspace could be opened. Contact a workspace owner or try signing in again.");
        } else {
          try {
            const saved = window.localStorage.getItem(STORAGE_KEY);
            if (saved) setState({ ...seedState, ...(JSON.parse(saved) as Partial<BdbState>) });
          } catch {
            window.localStorage.removeItem(STORAGE_KEY);
          }
        }
      } catch (error) {
        console.error("Workspace initialisation failed", error);
        if (active) setLoadError("BDB OS could not load this workspace safely. No demo or cached records have been substituted. Refresh the page or contact support.");
      } finally {
        if (active) setReady(true);
      }
    }
    void initialise();

    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (ready && !workspaceId && !isSupabaseConfigured()) {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    }
  }, [ready, state, workspaceId]);

  const clearError = useCallback(() => {
    setLastError(null);
    setSyncStatus(workspaceId ? "saved" : "idle");
  }, [workspaceId]);

  const persist = useCallback(async (operation: () => Promise<void>, failureMessage: string) => {
    if (!workspaceId) return true;
    if (typeof navigator !== "undefined" && !navigator.onLine) {
      setSyncStatus("offline");
      setLastError("This workspace is offline and currently view-only. Reconnect before making changes.");
      return false;
    }
    setSyncStatus("saving");
    setLastError(null);
    try {
      await operation();
      setSyncStatus("saved");
      return true;
    } catch (error) {
      console.error(failureMessage, error);
      setSyncStatus("error");
      setLastError(`${failureMessage} No local success state was recorded.`);
      return false;
    }
  }, [workspaceId]);

  const addCustomer = useCallback(async (customer: NewCustomer) => {
    const current = stateRef.current;
    const nextNumber = 1048 + current.customers.length;
    const created: Customer = { ...customer, id: makeId("cus"), code: `CL-${nextNumber}`, createdAt: new Date().toISOString() };
    const saved = await persist(
      () => cloudInsert("customers", { id: created.id, workspace_id: workspaceId, code: created.code, name: created.name, company: created.company, email: created.email, phone: created.phone, address: created.address, notes: created.notes }),
      "The customer could not be saved.",
    );
    if (!saved) return false;
    setState((latest) => ({ ...latest, customers: [created, ...latest.customers], activity: addActivity(latest, "Customer added", `${created.name} · ${created.code}`, "blue") }));
    return true;
  }, [persist, workspaceId]);

  const addInvoice = useCallback(async (invoice: NewInvoice) => {
    const current = stateRef.current;
    const id = makeId("inv");
    let issuedAt = new Date().toISOString().slice(0, 10);
    const numbers = current.invoices.map((item) => Number(item.number.split("-").at(-1)) || 0);
    const nextNumber = Math.max(...numbers, 1000) + 1;
    let number = `${current.settings.invoicePrefix}-${nextNumber}`;
    const saved = await persist(
      async () => {
        if (!workspaceId) return;
        const result = await createWorkspaceInvoice({
          workspaceId,
          invoiceId: id,
          customerId: invoice.customerId,
          dueAt: invoice.dueAt,
          description: invoice.description,
          amount: invoice.amount,
          status: invoice.status as "draft" | "sent",
        });
        number = result.number;
        issuedAt = result.issuedAt;
      },
      "The invoice could not be saved.",
    );
    if (!saved) return false;
    const created: Invoice = { ...invoice, id, number, issuedAt };
    setState((latest) => {
      const customer = latest.customers.find((item) => item.id === created.customerId);
      return { ...latest, invoices: [created, ...latest.invoices], activity: addActivity(latest, "Invoice created", `${created.number} for ${customer?.name ?? "customer"}`, "gold") };
    });
    return true;
  }, [persist, workspaceId]);

  const markInvoicePaid = useCallback(async (id: string) => {
    const invoice = stateRef.current.invoices.find((item) => item.id === id);
    if (!invoice) return false;
    const saved = await persist(() => cloudUpdate("invoices", { status: "paid" }, id), "The invoice status could not be updated.");
    if (!saved) return false;
    setState((latest) => ({ ...latest, invoices: latest.invoices.map((item) => item.id === id ? { ...item, status: "paid" as const } : item), activity: addActivity(latest, "Payment approved", `${invoice.number} marked as paid`, "green") }));
    return true;
  }, [persist]);

  const addBooking = useCallback(async (booking: NewBooking) => {
    const created: Booking = { ...booking, id: makeId("book") };
    const saved = await persist(
      () => cloudInsert("bookings", { id: created.id, workspace_id: workspaceId, customer_id: created.customerId, title: created.title, booking_date: created.date, booking_time: created.time, duration_minutes: created.duration, staff_name: created.staff, status: created.status }),
      "The booking could not be saved.",
    );
    if (!saved) return false;
    setState((latest) => {
      const customer = latest.customers.find((item) => item.id === booking.customerId);
      return { ...latest, bookings: [...latest.bookings, created].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)), activity: addActivity(latest, "Booking created", `${booking.title} with ${customer?.name ?? "customer"}`, "neutral") };
    });
    return true;
  }, [persist, workspaceId]);

  const sendMessage = useCallback(async (message: NewMessage) => {
    const created: Message = { ...message, id: makeId("msg"), timestamp: new Date().toISOString(), unread: false, status: "replied" };
    const saved = await persist(
      () => cloudInsert("messages", { id: created.id, workspace_id: workspaceId, customer_id: created.customerId, channel: created.channel, subject: created.subject, preview: created.preview, occurred_at: created.timestamp, unread: false, status: "replied" }),
      "The communication record could not be saved.",
    );
    if (!saved) return false;
    setState((latest) => ({ ...latest, messages: [created, ...latest.messages], activity: addActivity(latest, "Communication recorded", message.subject, "blue") }));
    return true;
  }, [persist, workspaceId]);

  const markMessageRead = useCallback(async (id: string) => {
    const saved = await persist(() => cloudUpdate("messages", { unread: false }, id), "The message status could not be updated.");
    if (!saved) return false;
    setState((latest) => ({ ...latest, messages: latest.messages.map((item) => item.id === id ? { ...item, unread: false } : item) }));
    return true;
  }, [persist]);

  const dismissMessageDraft = useCallback(async (id: string) => {
    const message = stateRef.current.messages.find((item) => item.id === id);
    const saved = await persist(() => cloudUpdate("messages", { status: "open" }, id), "The draft status could not be updated.");
    if (!saved) return false;
    setState((latest) => ({ ...latest, messages: latest.messages.map((item) => item.id === id ? { ...item, status: "open" as const } : item), activity: addActivity(latest, "Suggested reply dismissed", message?.subject ?? "Message", "neutral") }));
    return true;
  }, [persist]);

  const addDocument = useCallback(async (document: NewDocument, file?: File) => {
    const created: BusinessDocument = { ...document, id: makeId("doc"), uploadedAt: new Date().toISOString() };
    let storagePath: string | null = null;
    const saved = await persist(async () => {
      storagePath = file && workspaceId ? await uploadWorkspaceDocument(workspaceId, file) : null;
      try {
        await cloudInsert("documents", { id: created.id, workspace_id: workspaceId, name: created.name, document_type: created.type, size_label: created.size, customer_id: created.customerId ?? null, linked_to: created.linkedTo, uploaded_at: created.uploadedAt, storage_path: storagePath });
      } catch (error) {
        if (storagePath) await removeWorkspaceDocument(storagePath).catch(() => undefined);
        throw error;
      }
    }, "The document could not be uploaded.");
    if (!saved) return false;
    setState((latest) => ({ ...latest, documents: [created, ...latest.documents], activity: addActivity(latest, "Document uploaded", `${document.name} · ${document.linkedTo}`, "blue") }));
    return true;
  }, [persist, workspaceId]);

  const reconcileTransaction = useCallback(async (transactionId: string, invoiceId?: string) => {
    const transaction = stateRef.current.transactions.find((item) => item.id === transactionId);
    const invoice = invoiceId ? stateRef.current.invoices.find((item) => item.id === invoiceId) : undefined;
    if (!transaction) return false;
    const saved = await persist(async () => {
      if (!workspaceId) return;
      await reconcileWorkspaceTransaction({ workspaceId, transactionId, invoiceId });
    }, "The transaction could not be reconciled atomically.");
    if (!saved) return false;
    setState((latest) => ({
      ...latest,
      transactions: latest.transactions.map((item) => item.id === transactionId ? { ...item, status: "matched" as const, matchedInvoiceId: invoiceId } : item),
      invoices: invoiceId ? latest.invoices.map((item) => item.id === invoiceId ? { ...item, status: "paid" as const } : item) : latest.invoices,
      activity: addActivity(latest, "Transaction reconciled", `${transaction?.description ?? "Transaction"}${invoice ? ` → ${invoice.number}` : ""}`, "green"),
    }));
    return true;
  }, [persist, workspaceId]);

  const toggleAutomation = useCallback(async (id: string) => {
    const automation = stateRef.current.automations.find((item) => item.id === id);
    if (!automation) return false;
    const enabled = !automation.enabled;
    const saved = await persist(() => cloudUpdate("automations", { enabled }, id), "The automation setting could not be saved.");
    if (!saved) return false;
    setState((latest) => ({ ...latest, automations: latest.automations.map((item: Automation) => item.id === id ? { ...item, enabled } : item), activity: addActivity(latest, `Automation ${enabled ? "enabled" : "paused"}`, automation.name, "gold") }));
    return true;
  }, [persist]);

  const updateSettings = useCallback(async (settings: BusinessSettings) => {
    const saved = await persist(async () => {
      await cloudUpsert("workspace_settings", { workspace_id: workspaceId, owner_name: settings.ownerName, email: settings.email, phone: settings.phone, currency: settings.currency, invoice_prefix: settings.invoicePrefix, vat_rate: settings.vatRate }, "workspace_id");
      if (workspaceId) await cloudUpdate("workspaces", { name: settings.businessName }, workspaceId);
    }, "The business profile could not be saved completely.");
    if (!saved) return false;
    setState((latest) => ({ ...latest, settings, activity: addActivity(latest, "Settings updated", "Business profile saved", "neutral") }));
    return true;
  }, [persist, workspaceId]);

  const updateTheme = useCallback(async (theme: WorkspaceTheme) => {
    const saved = await persist(
      () => cloudUpsert("workspace_themes", { workspace_id: workspaceId, preset: theme.preset, mode: theme.mode, accent_color: theme.accentColor, font_family: theme.fontFamily, text_scale: theme.textScale, density: theme.density, high_contrast: theme.highContrast, reduced_motion: theme.reducedMotion, client_logo_path: theme.clientLogoPath ?? null }, "workspace_id"),
      "The workspace appearance could not be saved.",
    );
    if (!saved) return false;
    setState((latest) => ({ ...latest, theme, activity: addActivity(latest, "Appearance updated", `${theme.preset} · ${theme.mode}`, "gold") }));
    return true;
  }, [persist, workspaceId]);

  const uploadLogo = useCallback(async (file: File) => {
    if (!workspaceId) {
      const url = URL.createObjectURL(file);
      return updateTheme({ ...stateRef.current.theme, clientLogoUrl: url, clientLogoPath: file.name });
    }
    const saved = await persist(async () => {
      const uploaded = await uploadWorkspaceLogo(workspaceId, file);
      await cloudUpsert("workspace_themes", { workspace_id: workspaceId, preset: stateRef.current.theme.preset, mode: stateRef.current.theme.mode, accent_color: stateRef.current.theme.accentColor, font_family: stateRef.current.theme.fontFamily, text_scale: stateRef.current.theme.textScale, density: stateRef.current.theme.density, high_contrast: stateRef.current.theme.highContrast, reduced_motion: stateRef.current.theme.reducedMotion, client_logo_path: uploaded.path }, "workspace_id");
      setState((latest) => ({ ...latest, theme: { ...latest.theme, clientLogoPath: uploaded.path, clientLogoUrl: uploaded.url }, activity: addActivity(latest, "Logo updated", file.name, "gold") }));
    }, "The workspace logo could not be saved.");
    return saved;
  }, [persist, updateTheme, workspaceId]);

  const resetDemo = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState(seedState);
    setLastError(null);
    setSyncStatus("idle");
  }, []);

  const value = useMemo(() => ({
    state,
    ready,
    mode: workspaceId ? "cloud" as const : "demo" as const,
    workspaceId,
    role,
    syncStatus,
    lastError,
    clearError,
    addCustomer,
    addInvoice,
    markInvoicePaid,
    addBooking,
    sendMessage,
    markMessageRead,
    dismissMessageDraft,
    addDocument,
    reconcileTransaction,
    toggleAutomation,
    updateSettings,
    updateTheme,
    uploadLogo,
    resetDemo,
  }), [state, ready, workspaceId, role, syncStatus, lastError, clearError, addCustomer, addInvoice, markInvoicePaid, addBooking, sendMessage, markMessageRead, dismissMessageDraft, addDocument, reconcileTransaction, toggleAutomation, updateSettings, updateTheme, uploadLogo, resetDemo]);

  if (!ready) {
    return <main className="mfa-shell"><section className="mfa-card"><p className="marketing-kicker">Secure workspace</p><h1>Opening BDB OS…</h1><p>Verifying access and loading the current business records.</p></section></main>;
  }

  if (loadError) {
    return <main className="mfa-shell"><section className="mfa-card"><p className="marketing-kicker">Workspace unavailable</p><h1>Your records were not loaded.</h1><p>{loadError}</p><button className="marketing-primary" type="button" onClick={() => window.location.reload()}>Try again</button></section></main>;
  }

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useBdb() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useBdb must be used inside BdbProvider");
  return context;
}
