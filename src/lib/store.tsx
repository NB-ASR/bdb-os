"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
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
import { cloudInsert, cloudUpdate, cloudUpsert, loadCloudWorkspace, uploadWorkspaceDocument, uploadWorkspaceLogo } from "./cloud-store";

const STORAGE_KEY = "bdb-os-state-v1";

type NewCustomer = Omit<Customer, "id" | "code" | "createdAt">;
type NewInvoice = Omit<Invoice, "id" | "number" | "issuedAt">;
type NewBooking = Omit<Booking, "id">;
type NewMessage = Omit<Message, "id" | "timestamp" | "unread" | "status">;
type NewDocument = Omit<BusinessDocument, "id" | "uploadedAt">;

interface StoreValue {
  state: BdbState;
  ready: boolean;
  mode: "demo" | "cloud";
  role: string;
  addCustomer: (customer: NewCustomer) => void;
  addInvoice: (invoice: NewInvoice) => void;
  markInvoicePaid: (id: string) => void;
  addBooking: (booking: NewBooking) => void;
  sendMessage: (message: NewMessage) => void;
  markMessageRead: (id: string) => void;
  dismissMessageDraft: (id: string) => void;
  addDocument: (document: NewDocument, file?: File) => void;
  reconcileTransaction: (transactionId: string, invoiceId?: string) => void;
  toggleAutomation: (id: string) => void;
  updateSettings: (settings: BusinessSettings) => void;
  updateTheme: (theme: WorkspaceTheme) => void;
  uploadLogo: (file: File) => Promise<void>;
  resetDemo: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}`;
}

function addActivity(
  state: BdbState,
  action: string,
  detail: string,
  tone: "gold" | "green" | "blue" | "neutral" = "gold",
) {
  return [
    {
      id: makeId("act"),
      action,
      detail,
      timestamp: new Date().toISOString(),
      tone,
    },
    ...state.activity,
  ];
}

export function BdbProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BdbState>(seedState);
  const [ready, setReady] = useState(false);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [role, setRole] = useState("owner");

  useEffect(() => {
    let active = true;
    async function initialise() {
      const cloud = await loadCloudWorkspace().catch(() => null);
      if (!active) return;
      if (cloud) { setState(cloud.state); setWorkspaceId(cloud.workspaceId); setRole(cloud.role); }
      else {
        try {
          const saved = window.localStorage.getItem(STORAGE_KEY);
          if (saved) setState({ ...seedState, ...(JSON.parse(saved) as Partial<BdbState>) });
        } catch { window.localStorage.removeItem(STORAGE_KEY); }
      }
      setReady(true);
    }
    void initialise();

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (ready && !workspaceId) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [ready, state, workspaceId]);

  const addCustomer = useCallback((customer: NewCustomer) => {
    setState((current) => {
      const nextNumber = 1048 + current.customers.length;
      const created: Customer = {
        ...customer,
        id: makeId("cus"),
        code: `CL-${nextNumber}`,
        createdAt: new Date().toISOString(),
      };
      if (workspaceId) void cloudInsert("customers", { id: created.id, workspace_id: workspaceId, code: created.code, name: created.name, company: created.company, email: created.email, phone: created.phone, address: created.address, notes: created.notes });
      return {
        ...current,
        customers: [created, ...current.customers],
        activity: addActivity(current, "Customer added", `${created.name} · ${created.code}`, "blue"),
      };
    });
  }, [workspaceId]);

  const addInvoice = useCallback((invoice: NewInvoice) => {
    setState((current) => {
      const numbers = current.invoices.map((item) => Number(item.number.split("-").at(-1)) || 0);
      const nextNumber = Math.max(...numbers, 1000) + 1;
      const created: Invoice = {
        ...invoice,
        id: makeId("inv"),
        number: `${current.settings.invoicePrefix}-${nextNumber}`,
        issuedAt: new Date().toISOString().slice(0, 10),
      };
      if (workspaceId) void cloudInsert("invoices", { id: created.id, workspace_id: workspaceId, number: created.number, customer_id: created.customerId, issued_at: created.issuedAt, due_at: created.dueAt, description: created.description, amount: created.amount, status: created.status });
      const customer = current.customers.find((item) => item.id === created.customerId);
      return {
        ...current,
        invoices: [created, ...current.invoices],
        activity: addActivity(current, "Invoice created", `${created.number} for ${customer?.name ?? "customer"}`, "gold"),
      };
    });
  }, [workspaceId]);

  const markInvoicePaid = useCallback((id: string) => {
    setState((current) => {
      const invoice = current.invoices.find((item) => item.id === id);
      if (workspaceId) void cloudUpdate("invoices", { status: "paid" }, id);
      return {
        ...current,
        invoices: current.invoices.map((item) => item.id === id ? { ...item, status: "paid" as const } : item),
        activity: addActivity(current, "Payment approved", `${invoice?.number ?? "Invoice"} marked as paid`, "green"),
      };
    });
  }, [workspaceId]);

  const addBooking = useCallback((booking: NewBooking) => {
    setState((current) => {
      const created = { ...booking, id: makeId("book") };
      if (workspaceId) void cloudInsert("bookings", { id: created.id, workspace_id: workspaceId, customer_id: created.customerId, title: created.title, booking_date: created.date, booking_time: created.time, duration_minutes: created.duration, staff_name: created.staff, status: created.status });
      const customer = current.customers.find((item) => item.id === booking.customerId);
      return {
        ...current,
        bookings: [...current.bookings, created].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
        activity: addActivity(current, "Booking created", `${booking.title} with ${customer?.name ?? "customer"}`, "neutral"),
      };
    });
  }, [workspaceId]);

  const sendMessage = useCallback((message: NewMessage) => {
    const created = { ...message, id: makeId("msg"), timestamp: new Date().toISOString(), unread: false, status: "replied" as const };
    if (workspaceId) void cloudInsert("messages", { id: created.id, workspace_id: workspaceId, customer_id: created.customerId, channel: created.channel, subject: created.subject, preview: created.preview, occurred_at: created.timestamp, unread: false, status: "replied" });
    setState((current) => ({
      ...current,
      messages: [created, ...current.messages],
      activity: addActivity(current, "Message sent", message.subject, "blue"),
    }));
  }, [workspaceId]);

  const markMessageRead = useCallback((id: string) => {
    if (workspaceId) void cloudUpdate("messages", { unread: false }, id);
    setState((current) => ({
      ...current,
      messages: current.messages.map((item) => item.id === id ? { ...item, unread: false } : item),
    }));
  }, [workspaceId]);

  const dismissMessageDraft = useCallback((id: string) => {
    setState((current) => {
      const message = current.messages.find((item) => item.id === id);
      if (workspaceId) void cloudUpdate("messages", { status: "open" }, id);
      return {
        ...current,
        messages: current.messages.map((item) => item.id === id ? { ...item, status: "open" as const } : item),
        activity: addActivity(current, "Suggested reply dismissed", message?.subject ?? "Message", "neutral"),
      };
    });
  }, [workspaceId]);

  const addDocument = useCallback((document: NewDocument, file?: File) => {
    const created = { ...document, id: makeId("doc"), uploadedAt: new Date().toISOString() };
    if (workspaceId) void (async () => { const storagePath = file ? await uploadWorkspaceDocument(workspaceId, file) : null; await cloudInsert("documents", { id: created.id, workspace_id: workspaceId, name: created.name, document_type: created.type, size_label: created.size, customer_id: created.customerId ?? null, linked_to: created.linkedTo, uploaded_at: created.uploadedAt, storage_path: storagePath }); })().catch((error) => console.error("Document upload failed", error));
    setState((current) => ({
      ...current,
      documents: [created, ...current.documents],
      activity: addActivity(current, "Document uploaded", `${document.name} · ${document.linkedTo}`, "blue"),
    }));
  }, [workspaceId]);

  const reconcileTransaction = useCallback((transactionId: string, invoiceId?: string) => {
    setState((current) => {
      const transaction = current.transactions.find((item) => item.id === transactionId);
      const invoice = invoiceId ? current.invoices.find((item) => item.id === invoiceId) : undefined;
      if (workspaceId) { void cloudUpdate("bank_transactions", { status: "matched", matched_invoice_id: invoiceId ?? null }, transactionId); if (invoiceId) void cloudUpdate("invoices", { status: "paid" }, invoiceId); }
      return {
        ...current,
        transactions: current.transactions.map((item) => item.id === transactionId
          ? { ...item, status: "matched" as const, matchedInvoiceId: invoiceId }
          : item),
        invoices: invoiceId
          ? current.invoices.map((item) => item.id === invoiceId ? { ...item, status: "paid" as const } : item)
          : current.invoices,
        activity: addActivity(current, "Transaction reconciled", `${transaction?.description ?? "Transaction"}${invoice ? ` → ${invoice.number}` : ""}`, "green"),
      };
    });
  }, [workspaceId]);

  const toggleAutomation = useCallback((id: string) => {
    setState((current) => {
      const automation = current.automations.find((item) => item.id === id);
      const enabled = !automation?.enabled;
      if (workspaceId) void cloudUpdate("automations", { enabled }, id);
      return {
        ...current,
        automations: current.automations.map((item: Automation) => item.id === id ? { ...item, enabled } : item),
        activity: addActivity(current, `Automation ${enabled ? "enabled" : "paused"}`, automation?.name ?? "Workflow", "gold"),
      };
    });
  }, [workspaceId]);

  const updateSettings = useCallback((settings: BusinessSettings) => {
    if (workspaceId) void cloudUpsert("workspace_settings", { workspace_id: workspaceId, owner_name: settings.ownerName, email: settings.email, phone: settings.phone, currency: settings.currency, invoice_prefix: settings.invoicePrefix, vat_rate: settings.vatRate }, "workspace_id");
    if (workspaceId) void cloudUpdate("workspaces", { name: settings.businessName }, workspaceId);
    setState((current) => ({
      ...current,
      settings,
      activity: addActivity(current, "Settings updated", "Business profile saved", "neutral"),
    }));
  }, [workspaceId]);

  const updateTheme = useCallback((theme: WorkspaceTheme) => {
    setState((current) => ({ ...current, theme, activity: addActivity(current, "Appearance updated", `${theme.preset} · ${theme.mode}`, "gold") }));
    if (workspaceId) void cloudUpsert("workspace_themes", { workspace_id: workspaceId, preset: theme.preset, mode: theme.mode, accent_color: theme.accentColor, font_family: theme.fontFamily, text_scale: theme.textScale, density: theme.density, high_contrast: theme.highContrast, reduced_motion: theme.reducedMotion, client_logo_path: theme.clientLogoPath ?? null }, "workspace_id");
  }, [workspaceId]);

  const uploadLogo = useCallback(async (file: File) => {
    if (!workspaceId) { const url = URL.createObjectURL(file); updateTheme({ ...state.theme, clientLogoUrl: url, clientLogoPath: file.name }); return; }
    const uploaded = await uploadWorkspaceLogo(workspaceId, file);
    updateTheme({ ...state.theme, clientLogoPath: uploaded.path, clientLogoUrl: uploaded.url });
  }, [state.theme, updateTheme, workspaceId]);

  const resetDemo = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState(seedState);
  }, []);

  const value = useMemo(() => ({
    state,
    ready,
    mode: workspaceId ? "cloud" as const : "demo" as const,
    role,
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
  }), [
    state,
    ready,
    workspaceId,
    role,
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
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useBdb() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useBdb must be used inside BdbProvider");
  return context;
}
