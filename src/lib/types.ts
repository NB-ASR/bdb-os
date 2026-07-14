export type InvoiceStatus = "draft" | "sent" | "paid" | "overdue";
export type BookingStatus = "confirmed" | "pending" | "completed";

export interface Customer {
  id: string;
  code: string;
  name: string;
  company: string;
  email: string;
  phone: string;
  address: string;
  notes: string;
  createdAt: string;
}

export interface Invoice {
  id: string;
  number: string;
  customerId: string;
  issuedAt: string;
  dueAt: string;
  description: string;
  amount: number;
  status: InvoiceStatus;
}

export interface Booking {
  id: string;
  customerId: string;
  title: string;
  date: string;
  time: string;
  duration: number;
  staff: string;
  status: BookingStatus;
}

export interface Message {
  id: string;
  customerId: string;
  channel: "Email" | "WhatsApp" | "Instagram" | "Web";
  subject: string;
  preview: string;
  timestamp: string;
  unread: boolean;
  status: "open" | "replied" | "approval";
}

export interface BusinessDocument {
  id: string;
  name: string;
  type: string;
  size: string;
  customerId?: string;
  linkedTo: string;
  uploadedAt: string;
  storagePath?: string;
}

export interface BankTransaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: "credit" | "debit";
  status: "matched" | "unmatched" | "review";
  matchedInvoiceId?: string;
}

export interface Automation {
  id: string;
  name: string;
  description: string;
  trigger: string;
  enabled: boolean;
  lastRun: string;
}

export interface ActivityItem {
  id: string;
  action: string;
  detail: string;
  timestamp: string;
  tone: "gold" | "green" | "blue" | "neutral";
}

export interface BusinessSettings {
  businessName: string;
  ownerName: string;
  email: string;
  phone: string;
  currency: "GBP" | "EUR" | "USD";
  invoicePrefix: string;
  vatRate: number;
}

export interface BdbState {
  customers: Customer[];
  invoices: Invoice[];
  bookings: Booking[];
  messages: Message[];
  documents: BusinessDocument[];
  transactions: BankTransaction[];
  automations: Automation[];
  activity: ActivityItem[];
  settings: BusinessSettings;
}
