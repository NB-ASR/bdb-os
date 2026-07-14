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
} from "./types";

const STORAGE_KEY = "bdb-os-state-v1";

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

function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}-${crypto.randomUUID()}`;
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

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState(JSON.parse(saved) as BdbState);
      }
    } catch {
      window.localStorage.removeItem(STORAGE_KEY);
    }
    setReady(true);

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
    }
  }, []);

  useEffect(() => {
    if (ready) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [ready, state]);

  const addCustomer = useCallback((customer: NewCustomer) => {
    setState((current) => {
      const nextNumber = 1048 + current.customers.length;
      const created: Customer = {
        ...customer,
        id: makeId("cus"),
        code: `CL-${nextNumber}`,
        createdAt: new Date().toISOString(),
      };
      return {
        ...current,
        customers: [created, ...current.customers],
        activity: addActivity(current, "Customer added", `${created.name} · ${created.code}`, "blue"),
      };
    });
  }, []);

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
      const customer = current.customers.find((item) => item.id === created.customerId);
      return {
        ...current,
        invoices: [created, ...current.invoices],
        activity: addActivity(current, "Invoice created", `${created.number} for ${customer?.name ?? "customer"}`, "gold"),
      };
    });
  }, []);

  const markInvoicePaid = useCallback((id: string) => {
    setState((current) => {
      const invoice = current.invoices.find((item) => item.id === id);
      return {
        ...current,
        invoices: current.invoices.map((item) => item.id === id ? { ...item, status: "paid" as const } : item),
        activity: addActivity(current, "Payment approved", `${invoice?.number ?? "Invoice"} marked as paid`, "green"),
      };
    });
  }, []);

  const addBooking = useCallback((booking: NewBooking) => {
    setState((current) => {
      const created = { ...booking, id: makeId("book") };
      const customer = current.customers.find((item) => item.id === booking.customerId);
      return {
        ...current,
        bookings: [...current.bookings, created].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)),
        activity: addActivity(current, "Booking created", `${booking.title} with ${customer?.name ?? "customer"}`, "neutral"),
      };
    });
  }, []);

  const sendMessage = useCallback((message: NewMessage) => {
    setState((current) => ({
      ...current,
      messages: [{ ...message, id: makeId("msg"), timestamp: new Date().toISOString(), unread: false, status: "replied" }, ...current.messages],
      activity: addActivity(current, "Message sent", message.subject, "blue"),
    }));
  }, []);

  const markMessageRead = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      messages: current.messages.map((item) => item.id === id ? { ...item, unread: false } : item),
    }));
  }, []);

  const dismissMessageDraft = useCallback((id: string) => {
    setState((current) => {
      const message = current.messages.find((item) => item.id === id);
      return {
        ...current,
        messages: current.messages.map((item) => item.id === id ? { ...item, status: "open" as const } : item),
        activity: addActivity(current, "Suggested reply dismissed", message?.subject ?? "Message", "neutral"),
      };
    });
  }, []);

  const addDocument = useCallback((document: NewDocument) => {
    setState((current) => ({
      ...current,
      documents: [{ ...document, id: makeId("doc"), uploadedAt: new Date().toISOString() }, ...current.documents],
      activity: addActivity(current, "Document uploaded", `${document.name} · ${document.linkedTo}`, "blue"),
    }));
  }, []);

  const reconcileTransaction = useCallback((transactionId: string, invoiceId?: string) => {
    setState((current) => {
      const transaction = current.transactions.find((item) => item.id === transactionId);
      const invoice = invoiceId ? current.invoices.find((item) => item.id === invoiceId) : undefined;
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
  }, []);

  const toggleAutomation = useCallback((id: string) => {
    setState((current) => {
      const automation = current.automations.find((item) => item.id === id);
      const enabled = !automation?.enabled;
      return {
        ...current,
        automations: current.automations.map((item: Automation) => item.id === id ? { ...item, enabled } : item),
        activity: addActivity(current, `Automation ${enabled ? "enabled" : "paused"}`, automation?.name ?? "Workflow", "gold"),
      };
    });
  }, []);

  const updateSettings = useCallback((settings: BusinessSettings) => {
    setState((current) => ({
      ...current,
      settings,
      activity: addActivity(current, "Settings updated", "Business profile saved", "neutral"),
    }));
  }, []);

  const resetDemo = useCallback(() => {
    window.localStorage.removeItem(STORAGE_KEY);
    setState(seedState);
  }, []);

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
