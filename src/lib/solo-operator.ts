import type { BdbState, Booking, Customer, Invoice, Message } from "./types";

export type SoloOperatorView = "today" | "customers" | "calendar" | "inbox" | "money" | "documents" | "operator";
export type OperatorPriority = "urgent" | "today" | "upcoming";
export type OperatorAutonomy = "assist" | "approval" | "bounded";

export interface SoloOperatorAction {
  id: string;
  kind: "invoice" | "message" | "booking";
  priority: OperatorPriority;
  autonomy: OperatorAutonomy;
  title: string;
  detail: string;
  recordLabel: string;
  customerId?: string;
  destination: SoloOperatorView;
  dueAt?: string;
}

export interface SoloOperatorMetrics {
  todayBookings: number;
  unreadMessages: number;
  outstandingAmount: number;
  overdueAmount: number;
  overdueInvoices: number;
  openInvoices: number;
  nextBooking?: Booking;
}

export interface SoloCustomerSnapshot {
  customer: Customer;
  nextBooking?: Booking;
  openBalance: number;
  unreadMessages: number;
  documentCount: number;
  lastMessage?: Message;
}

export interface SoloOperatorSnapshot {
  actions: SoloOperatorAction[];
  metrics: SoloOperatorMetrics;
  customers: SoloCustomerSnapshot[];
  status: "attention" | "review" | "clear";
}

function bookingDateTime(booking: Booking) {
  return new Date(`${booking.date}T${booking.time}:00`);
}

function customerName(state: BdbState, customerId: string) {
  return state.customers.find((customer) => customer.id === customerId)?.name ?? "Customer";
}

function priorityRank(priority: OperatorPriority) {
  return priority === "urgent" ? 0 : priority === "today" ? 1 : 2;
}

function invoiceAction(state: BdbState, invoice: Invoice): SoloOperatorAction {
  const customer = customerName(state, invoice.customerId);
  return {
    id: `invoice-${invoice.id}`,
    kind: "invoice",
    priority: "urgent",
    autonomy: "approval",
    title: `Review overdue invoice for ${customer}`,
    detail: `${invoice.number} passed its due date on ${invoice.dueAt}. Prepare a reminder only after checking the customer history and payment record.`,
    recordLabel: invoice.number,
    customerId: invoice.customerId,
    destination: "money",
    dueAt: invoice.dueAt,
  };
}

function messageAction(state: BdbState, message: Message): SoloOperatorAction {
  const customer = customerName(state, message.customerId);
  return {
    id: `message-${message.id}`,
    kind: "message",
    priority: message.status === "approval" ? "urgent" : "today",
    autonomy: message.status === "approval" ? "approval" : "assist",
    title: message.status === "approval" ? `Approve reply to ${customer}` : `Review message from ${customer}`,
    detail: `${message.channel} · ${message.subject}. BDB can organise and draft the next step, but no external message is sent without the configured policy.`,
    recordLabel: message.subject,
    customerId: message.customerId,
    destination: "inbox",
    dueAt: message.timestamp,
  };
}

function bookingAction(state: BdbState, booking: Booking, now: Date): SoloOperatorAction {
  const customer = customerName(state, booking.customerId);
  const startsAt = bookingDateTime(booking);
  const hoursUntil = Math.max(0, Math.round((startsAt.getTime() - now.getTime()) / 3_600_000));
  const isToday = booking.date === now.toLocaleDateString("en-CA");
  const pending = booking.status === "pending";
  return {
    id: `booking-${booking.id}`,
    kind: "booking",
    priority: pending || isToday ? "today" : "upcoming",
    autonomy: pending ? "approval" : "assist",
    title: pending ? `Confirm ${customer}'s appointment` : `Check reminder for ${customer}`,
    detail: pending
      ? `${booking.title} is still pending at ${booking.time}. Confirm the booking before any reminder workflow continues.`
      : `${booking.title} starts in about ${hoursUntil} hour${hoursUntil === 1 ? "" : "s"}. Verify the reminder policy and customer preference.`,
    recordLabel: `${booking.date} · ${booking.time}`,
    customerId: booking.customerId,
    destination: "calendar",
    dueAt: startsAt.toISOString(),
  };
}

export function buildSoloOperatorSnapshot(state: BdbState, now = new Date()): SoloOperatorSnapshot {
  const todayKey = now.toLocaleDateString("en-CA");
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const reminderCutoff = new Date(now);
  reminderCutoff.setHours(reminderCutoff.getHours() + 36);

  const overdue = state.invoices.filter((invoice) => invoice.status === "overdue");
  const openInvoices = state.invoices.filter((invoice) => invoice.status === "sent" || invoice.status === "overdue");
  const unreadMessages = state.messages.filter((message) => message.unread || message.status === "approval");
  const futureBookings = state.bookings
    .filter((booking) => booking.status !== "completed" && bookingDateTime(booking).getTime() >= now.getTime())
    .sort((left, right) => bookingDateTime(left).getTime() - bookingDateTime(right).getTime());
  const reminderBookings = futureBookings.filter((booking) => bookingDateTime(booking).getTime() <= reminderCutoff.getTime());

  const actions = [
    ...overdue.map((invoice) => invoiceAction(state, invoice)),
    ...unreadMessages.map((message) => messageAction(state, message)),
    ...reminderBookings.map((booking) => bookingAction(state, booking, now)),
  ]
    .sort((left, right) => {
      const priorityDifference = priorityRank(left.priority) - priorityRank(right.priority);
      if (priorityDifference !== 0) return priorityDifference;
      return String(left.dueAt ?? "").localeCompare(String(right.dueAt ?? ""));
    });

  const customers = state.customers.map((customer) => {
    const invoices = state.invoices.filter((invoice) => invoice.customerId === customer.id && (invoice.status === "sent" || invoice.status === "overdue"));
    const messages = state.messages
      .filter((message) => message.customerId === customer.id)
      .sort((left, right) => right.timestamp.localeCompare(left.timestamp));
    const bookings = futureBookings.filter((booking) => booking.customerId === customer.id);
    return {
      customer,
      nextBooking: bookings[0],
      openBalance: invoices.reduce((total, invoice) => total + invoice.amount, 0),
      unreadMessages: messages.filter((message) => message.unread).length,
      documentCount: state.documents.filter((document) => document.customerId === customer.id).length,
      lastMessage: messages[0],
    } satisfies SoloCustomerSnapshot;
  }).sort((left, right) => {
    const leftScore = left.openBalance + left.unreadMessages * 1_000 + (left.nextBooking ? 100 : 0);
    const rightScore = right.openBalance + right.unreadMessages * 1_000 + (right.nextBooking ? 100 : 0);
    return rightScore - leftScore;
  });

  const metrics: SoloOperatorMetrics = {
    todayBookings: state.bookings.filter((booking) => booking.date === todayKey && booking.status !== "completed").length,
    unreadMessages: state.messages.filter((message) => message.unread).length,
    outstandingAmount: openInvoices.reduce((total, invoice) => total + invoice.amount, 0),
    overdueAmount: overdue.reduce((total, invoice) => total + invoice.amount, 0),
    overdueInvoices: overdue.length,
    openInvoices: openInvoices.length,
    nextBooking: futureBookings[0],
  };

  const status = overdue.length > 0 || unreadMessages.some((message) => message.status === "approval")
    ? "attention"
    : actions.length > 0
      ? "review"
      : "clear";

  return { actions, metrics, customers, status };
}
