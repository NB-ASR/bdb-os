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
import { createClient } from "./supabase/client";
import type { TablesInsert, TablesUpdate } from "./supabase/database.types";
import { useSaas } from "./saas/context";
import type {
  Automation,
  BdbState,
  Booking,
  BusinessDocument,
  BusinessSettings,
  Customer,
  Invoice,
  Message,
} from "./types";

const STORAGE_KEY = "bdb-os-state-v2";

type NewCustomer = Omit<Customer, "id" | "code" | "createdAt">;
type NewInvoice = Omit<Invoice, "id" | "number" | "issuedAt">;
type NewBooking = Omit<Booking, "id">;
type NewMessage = Omit<Message, "id" | "timestamp" | "unread" | "status">;
type NewDocument = Omit<BusinessDocument, "id" | "uploadedAt">;

interface StoreValue {
  state: BdbState;
  ready: boolean;
  addCustomer: (customer: NewCustomer) => void;
  addInvoice: (invoice: NewInvoice) => void;
  markInvoicePaid: (id: string) => void;
  addBooking: (booking: NewBooking) => void;
  sendMessage: (message: NewMessage) => void;
  markMessageRead: (id: string) => void;
  dismissMessageDraft: (id: string) => void;
  addDocument: (document: NewDocument) => void;
  reconcileTransaction: (transactionId: string, invoiceId?: string) => void;
  toggleAutomation: (id: string) => void;
  updateSettings: (settings: BusinessSettings) => void;
  resetDemo: () => void;
}

const StoreContext = createContext<StoreValue | null>(null);

function makeId(prefix: string, live = false) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    const id = crypto.randomUUID();
    return live ? id : `${prefix}-${id}`;
  }
  return `${prefix}-${Date.now()}`;
}

function rows(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object") : [];
}

function asRow(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function number(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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
  const { mode, workspace, user, loading: saasLoading } = useSaas();
  const [state, setState] = useState<BdbState>(seedState);
  const [ready, setReady] = useState(false);
  const live = mode === "live";

  useEffect(() => {
    if (saasLoading) return;
    if (!live) {
      const key = `${STORAGE_KEY}:${workspace?.id ?? "demo"}`;
      let savedState: BdbState | null = null;
      try {
        const saved = window.localStorage.getItem(key);
        if (saved) savedState = JSON.parse(saved) as BdbState;
      } catch {
        window.localStorage.removeItem(key);
      }
      const frame = window.requestAnimationFrame(() => {
        if (savedState) setState(savedState);
        setReady(true);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    if (!workspace) {
      const frame = window.requestAnimationFrame(() => {
        setState({ ...seedState, customers: [], invoices: [], bookings: [], messages: [], documents: [], transactions: [], automations: [], activity: [], settings: { ...seedState.settings, businessName: "Your business", ownerName: user?.name ?? "" } });
        setReady(true);
      });
      return () => window.cancelAnimationFrame(frame);
    }

    let active = true;
    async function loadWorkspace() {
      const supabase = createClient();
      if (!supabase || !workspace) return;
      setReady(false);
      const [customers, invoices, bookings, messages, documents, transactions, automations, activity, settings] = await Promise.all([
        supabase.from("customers").select("*").eq("workspace_id", workspace.id).order("created_at", { ascending: false }),
        supabase.from("invoices").select("*").eq("workspace_id", workspace.id).order("issued_at", { ascending: false }),
        supabase.from("bookings").select("*").eq("workspace_id", workspace.id).order("booking_date").order("booking_time"),
        supabase.from("messages").select("*").eq("workspace_id", workspace.id).order("occurred_at", { ascending: false }),
        supabase.from("documents").select("*").eq("workspace_id", workspace.id).order("uploaded_at", { ascending: false }),
        supabase.from("bank_transactions").select("*").eq("workspace_id", workspace.id).order("transaction_date", { ascending: false }),
        supabase.from("automations").select("*").eq("workspace_id", workspace.id).order("created_at"),
        supabase.from("activity_items").select("*").eq("workspace_id", workspace.id).order("occurred_at", { ascending: false }).limit(100),
        supabase.from("workspace_settings").select("*").eq("workspace_id", workspace.id).maybeSingle(),
      ]);
      if (!active) return;
      const settingsRow = asRow(settings.data);
      setState({
        customers: rows(customers.data).map((row) => ({ id: text(row.id), code: text(row.code), name: text(row.name), company: text(row.company), email: text(row.email), phone: text(row.phone), address: text(row.address), notes: text(row.notes), createdAt: text(row.created_at) })),
        invoices: rows(invoices.data).map((row) => ({ id: text(row.id), number: text(row.number), customerId: text(row.customer_id), issuedAt: text(row.issued_at), dueAt: text(row.due_at), description: text(row.description), amount: number(row.amount), status: text(row.status) as Invoice["status"] })),
        bookings: rows(bookings.data).map((row) => ({ id: text(row.id), customerId: text(row.customer_id), title: text(row.title), date: text(row.booking_date), time: text(row.booking_time).slice(0, 5), duration: number(row.duration_minutes), staff: text(row.staff_name), status: text(row.status) as Booking["status"] })),
        messages: rows(messages.data).map((row) => ({ id: text(row.id), customerId: text(row.customer_id), channel: text(row.channel) as Message["channel"], subject: text(row.subject), preview: text(row.preview), timestamp: text(row.occurred_at), unread: Boolean(row.unread), status: text(row.status) as Message["status"] })),
        documents: rows(documents.data).map((row) => ({ id: text(row.id), name: text(row.name), type: text(row.document_type), size: text(row.size_label), customerId: row.customer_id ? text(row.customer_id) : undefined, linkedTo: text(row.linked_to), uploadedAt: text(row.uploaded_at), storagePath: row.storage_path ? text(row.storage_path) : undefined })),
        transactions: rows(transactions.data).map((row) => ({ id: text(row.id), date: text(row.transaction_date), description: text(row.description), amount: number(row.amount), type: text(row.transaction_type) as "credit" | "debit", status: text(row.status) as "matched" | "unmatched" | "review", matchedInvoiceId: row.matched_invoice_id ? text(row.matched_invoice_id) : undefined })),
        automations: rows(automations.data).map((row) => ({ id: text(row.id), name: text(row.name), description: text(row.description), trigger: text(row.trigger_description), enabled: Boolean(row.enabled), lastRun: text(row.last_run_at) })),
        activity: rows(activity.data).map((row) => ({ id: text(row.id), action: text(row.action), detail: text(row.detail), timestamp: text(row.occurred_at), tone: text(row.tone) as "gold" | "green" | "blue" | "neutral" })),
        settings: {
          businessName: workspace.name,
          ownerName: text(settingsRow.owner_name) || user?.name || "Workspace owner",
          email: text(settingsRow.email),
          phone: text(settingsRow.phone),
          currency: (text(settingsRow.currency) || "GBP") as BusinessSettings["currency"],
          invoicePrefix: text(settingsRow.invoice_prefix) || "BDB",
          vatRate: settingsRow.vat_rate === null || settingsRow.vat_rate === undefined ? 20 : number(settingsRow.vat_rate),
        },
      });
      setReady(true);
    }
    void loadWorkspace();
    return () => { active = false; };
  }, [live, saasLoading, user?.name, workspace]);

  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (ready && !live) window.localStorage.setItem(`${STORAGE_KEY}:${workspace?.id ?? "demo"}`, JSON.stringify(state));
  }, [live, ready, state, workspace?.id]);

  const insert = useCallback((table: "activity_items" | "bookings" | "customers" | "documents" | "invoices" | "messages", values: Record<string, unknown>) => {
    if (!live || !workspace) return;
    const supabase = createClient();
    if (!supabase) return;
    const row = { ...values, workspace_id: workspace.id };
    if (table === "activity_items") void supabase.from("activity_items").insert(row as TablesInsert<"activity_items">);
    if (table === "bookings") void supabase.from("bookings").insert(row as TablesInsert<"bookings">);
    if (table === "customers") void supabase.from("customers").insert(row as TablesInsert<"customers">);
    if (table === "documents") void supabase.from("documents").insert(row as TablesInsert<"documents">);
    if (table === "invoices") void supabase.from("invoices").insert(row as TablesInsert<"invoices">);
    if (table === "messages") void supabase.from("messages").insert(row as TablesInsert<"messages">);
  }, [live, workspace]);

  const update = useCallback((table: "automations" | "bank_transactions" | "invoices" | "messages", id: string, values: Record<string, unknown>) => {
    if (!live || !workspace) return;
    const supabase = createClient();
    if (!supabase) return;
    if (table === "automations") void supabase.from("automations").update(values as TablesUpdate<"automations">).eq("workspace_id", workspace.id).eq("id", id);
    if (table === "bank_transactions") void supabase.from("bank_transactions").update(values as TablesUpdate<"bank_transactions">).eq("workspace_id", workspace.id).eq("id", id);
    if (table === "invoices") void supabase.from("invoices").update(values as TablesUpdate<"invoices">).eq("workspace_id", workspace.id).eq("id", id);
    if (table === "messages") void supabase.from("messages").update(values as TablesUpdate<"messages">).eq("workspace_id", workspace.id).eq("id", id);
  }, [live, workspace]);

  const recordActivity = useCallback((action: string, detail: string, tone: "gold" | "green" | "blue" | "neutral") => {
    insert("activity_items", { id: makeId("act", live), actor_user_id: user?.id ?? null, action, detail, tone, occurred_at: new Date().toISOString() });
  }, [insert, live, user?.id]);

  const addCustomer = useCallback((customer: NewCustomer) => {
    const nextNumber = 1048 + state.customers.length;
    const created: Customer = { ...customer, id: makeId("cus", live), code: `CL-${nextNumber}`, createdAt: new Date().toISOString() };
    setState((current) => {
      return {
        ...current,
        customers: [created, ...current.customers],
        activity: addActivity(current, "Customer added", `${created.name} · ${created.code}`, "blue"),
      };
    });
    insert("customers", { id: created.id, code: created.code, name: created.name, company: created.company, email: created.email || null, phone: created.phone || null, address: created.address || null, notes: created.notes || null, created_at: created.createdAt });
    recordActivity("Customer added", `${created.name} · ${created.code}`, "blue");
  }, [insert, live, recordActivity, state.customers.length]);

  const addInvoice = useCallback((invoice: NewInvoice) => {
    const numbers = state.invoices.map((item) => Number(item.number.split("-").at(-1)) || 0);
    const nextNumber = Math.max(...numbers, 1000) + 1;
    const created: Invoice = { ...invoice, id: makeId("inv", live), number: `${state.settings.invoicePrefix}-${nextNumber}`, issuedAt: new Date().toISOString().slice(0, 10) };
    const customer = state.customers.find((item) => item.id === created.customerId);
    setState((current) => {
      return {
        ...current,
        invoices: [created, ...current.invoices],
        activity: addActivity(current, "Invoice created", `${created.number} for ${customer?.name ?? "customer"}`, "gold"),
      };
    });
    insert("invoices", { id: created.id, number: created.number, customer_id: created.customerId, issued_at: created.issuedAt, due_at: created.dueAt, description: created.description, amount: created.amount, status: created.status });
    recordActivity("Invoice created", `${created.number} for ${customer?.name ?? "customer"}`, "gold");
  }, [insert, live, recordActivity, state.customers, state.invoices, state.settings.invoicePrefix]);

  const markInvoicePaid = useCallback((id: string) => {
    const invoice = state.invoices.find((item) => item.id === id);
    setState((current) => {
      return {
        ...current,
        invoices: current.invoices.map((item) => item.id === id ? { ...item, status: "paid" as const } : item),
        activity: addActivity(current, "Payment approved", `${invoice?.number ?? "Invoice"} marked as paid`, "green"),
      };
    });
    update("invoices", id, { status: "paid" });
    recordActivity("Payment approved", `${invoice?.number ?? "Invoice"} marked as paid`, "green");
  }, [recordActivity, state.invoices, update]);

  const addBooking = useCallback((booking: NewBooking) => {
    const created = { ...booking, id: makeId("book", live) };
    const customer = state.customers.find((item) => item.id === booking.customerId);
    setState((current) => {
      return {
        ...current,
        bookings: [...current.bookings, created].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
        activity: addActivity(current, "Booking created", `${booking.title} with ${customer?.name ?? "customer"}`, "neutral"),
      };
    });
    insert("bookings", { id: created.id, customer_id: created.customerId, title: created.title, booking_date: created.date, booking_time: created.time, duration_minutes: created.duration, staff_name: created.staff, status: created.status });
    recordActivity("Booking created", `${booking.title} with ${customer?.name ?? "customer"}`, "neutral");
  }, [insert, live, recordActivity, state.customers]);

  const sendMessage = useCallback((message: NewMessage) => {
    const created: Message = { ...message, id: makeId("msg", live), timestamp: new Date().toISOString(), unread: false, status: "replied" };
    setState((current) => ({
      ...current,
      messages: [created, ...current.messages],
      activity: addActivity(current, "Message sent", message.subject, "blue"),
    }));
    insert("messages", { id: created.id, customer_id: created.customerId, channel: created.channel, subject: created.subject, preview: created.preview, occurred_at: created.timestamp, unread: false, status: "replied" });
    recordActivity("Message sent", message.subject, "blue");
  }, [insert, live, recordActivity]);

  const markMessageRead = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      messages: current.messages.map((item) => item.id === id ? { ...item, unread: false } : item),
    }));
    update("messages", id, { unread: false });
  }, [update]);

  const dismissMessageDraft = useCallback((id: string) => {
    const message = state.messages.find((item) => item.id === id);
    setState((current) => {
      return {
        ...current,
        messages: current.messages.map((item) => item.id === id ? { ...item, status: "open" as const } : item),
        activity: addActivity(current, "Suggested reply dismissed", message?.subject ?? "Message", "neutral"),
      };
    });
    update("messages", id, { status: "open" });
    recordActivity("Suggested reply dismissed", message?.subject ?? "Message", "neutral");
  }, [recordActivity, state.messages, update]);

  const addDocument = useCallback((document: NewDocument) => {
    const created: BusinessDocument = { ...document, id: makeId("doc", live), uploadedAt: new Date().toISOString() };
    setState((current) => ({
      ...current,
      documents: [created, ...current.documents],
      activity: addActivity(current, "Document uploaded", `${document.name} · ${document.linkedTo}`, "blue"),
    }));
    insert("documents", { id: created.id, customer_id: created.customerId ?? null, name: created.name, document_type: created.type, size_label: created.size, storage_path: created.storagePath ?? null, linked_to: created.linkedTo, uploaded_at: created.uploadedAt });
    recordActivity("Document uploaded", `${document.name} · ${document.linkedTo}`, "blue");
  }, [insert, live, recordActivity]);

  const reconcileTransaction = useCallback((transactionId: string, invoiceId?: string) => {
    const transaction = state.transactions.find((item) => item.id === transactionId);
    const invoice = invoiceId ? state.invoices.find((item) => item.id === invoiceId) : undefined;
    setState((current) => {
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
    update("bank_transactions", transactionId, { status: "matched", matched_invoice_id: invoiceId ?? null });
    if (invoiceId) update("invoices", invoiceId, { status: "paid" });
    recordActivity("Transaction reconciled", `${transaction?.description ?? "Transaction"}${invoice ? ` → ${invoice.number}` : ""}`, "green");
  }, [recordActivity, state.invoices, state.transactions, update]);

  const toggleAutomation = useCallback((id: string) => {
    const automation = state.automations.find((item) => item.id === id);
    const enabled = !automation?.enabled;
    setState((current) => {
      return {
        ...current,
        automations: current.automations.map((item: Automation) => item.id === id ? { ...item, enabled } : item),
        activity: addActivity(current, `Automation ${enabled ? "enabled" : "paused"}`, automation?.name ?? "Workflow", "gold"),
      };
    });
    update("automations", id, { enabled });
    recordActivity(`Automation ${enabled ? "enabled" : "paused"}`, automation?.name ?? "Workflow", "gold");
  }, [recordActivity, state.automations, update]);

  const updateSettings = useCallback((settings: BusinessSettings) => {
    setState((current) => ({
      ...current,
      settings,
      activity: addActivity(current, "Settings updated", "Business profile saved", "neutral"),
    }));
    if (live && workspace) {
      const supabase = createClient();
      if (supabase) {
        void supabase.from("workspaces").update({ name: settings.businessName }).eq("id", workspace.id);
        void supabase.from("workspace_settings").upsert({ workspace_id: workspace.id, owner_name: settings.ownerName, email: settings.email || null, phone: settings.phone || null, currency: settings.currency, invoice_prefix: settings.invoicePrefix, vat_rate: settings.vatRate }, { onConflict: "workspace_id" });
      }
    }
    recordActivity("Settings updated", "Business profile saved", "neutral");
  }, [live, recordActivity, workspace]);

  const resetDemo = useCallback(() => {
    window.localStorage.removeItem(`${STORAGE_KEY}:${workspace?.id ?? "demo"}`);
    setState(seedState);
  }, [workspace?.id]);

  const value = useMemo(() => ({
    state,
    ready,
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
    resetDemo,
  }), [
    state,
    ready,
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
    resetDemo,
  ]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useBdb() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useBdb must be used inside BdbProvider");
  return context;
}
