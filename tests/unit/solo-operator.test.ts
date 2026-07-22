import test from "node:test";
import assert from "node:assert/strict";
import { buildSoloOperatorSnapshot } from "../../src/lib/solo-operator.ts";
import type { BdbState } from "../../src/lib/types.ts";

function baseState(): BdbState {
  return {
    customers: [
      { id: "c1", code: "CL-1", name: "Maya Borg", company: "", email: "maya@example.com", phone: "", address: "", notes: "", createdAt: "2026-07-01T09:00:00.000Z" },
      { id: "c2", code: "CL-2", name: "Luke Vella", company: "", email: "luke@example.com", phone: "", address: "", notes: "", createdAt: "2026-07-02T09:00:00.000Z" },
    ],
    invoices: [],
    bookings: [],
    messages: [],
    documents: [],
    transactions: [],
    automations: [],
    activity: [],
    settings: { businessName: "Solo Studio", ownerName: "Alex", email: "alex@example.com", phone: "", currency: "EUR", invoicePrefix: "INV", vatRate: 18 },
    theme: { preset: "obsidian-gold", mode: "dark", accentColor: "#d4a852", fontFamily: "manrope", textScale: 1, density: "comfortable", highContrast: false, reducedMotion: false },
  };
}

test("overdue invoices are prioritised before messages and bookings", () => {
  const state = baseState();
  state.invoices.push({ id: "i1", number: "INV-1001", customerId: "c1", issuedAt: "2026-07-01", dueAt: "2026-07-18", description: "Consultation", amount: 180, status: "overdue" });
  state.messages.push({ id: "m1", customerId: "c2", channel: "Email", subject: "New enquiry", preview: "Can we book?", timestamp: "2026-07-20T08:00:00.000Z", unread: true, status: "open" });
  state.bookings.push({ id: "b1", customerId: "c2", title: "Planning call", date: "2026-07-21", time: "11:00", duration: 60, staff: "Alex", status: "confirmed" });

  const snapshot = buildSoloOperatorSnapshot(state, new Date("2026-07-20T09:00:00.000Z"));

  assert.equal(snapshot.actions[0]?.kind, "invoice");
  assert.equal(snapshot.actions[0]?.priority, "urgent");
  assert.equal(snapshot.metrics.outstandingAmount, 180);
  assert.equal(snapshot.metrics.overdueInvoices, 1);
  assert.equal(snapshot.status, "attention");
});

test("approval messages remain approval-gated", () => {
  const state = baseState();
  state.messages.push({ id: "m1", customerId: "c1", channel: "WhatsApp", subject: "Change appointment", preview: "Can we move it?", timestamp: "2026-07-20T08:00:00.000Z", unread: false, status: "approval" });

  const snapshot = buildSoloOperatorSnapshot(state, new Date("2026-07-20T09:00:00.000Z"));

  assert.equal(snapshot.actions.length, 1);
  assert.equal(snapshot.actions[0]?.autonomy, "approval");
  assert.match(snapshot.actions[0]?.title ?? "", /Approve reply/);
});

test("customer snapshots connect balances, messages, bookings and documents", () => {
  const state = baseState();
  state.invoices.push({ id: "i1", number: "INV-1001", customerId: "c1", issuedAt: "2026-07-01", dueAt: "2026-07-25", description: "Consultation", amount: 240, status: "sent" });
  state.messages.push({ id: "m1", customerId: "c1", channel: "Email", subject: "Thank you", preview: "See you soon", timestamp: "2026-07-20T08:00:00.000Z", unread: true, status: "open" });
  state.bookings.push({ id: "b1", customerId: "c1", title: "Consultation", date: "2026-07-22", time: "10:00", duration: 60, staff: "Alex", status: "confirmed" });
  state.documents.push({ id: "d1", name: "Brief.pdf", type: "PDF", size: "1 MB", customerId: "c1", linkedTo: "Maya Borg", uploadedAt: "2026-07-19T10:00:00.000Z" });

  const snapshot = buildSoloOperatorSnapshot(state, new Date("2026-07-20T09:00:00.000Z"));
  const maya = snapshot.customers.find((item) => item.customer.id === "c1");

  assert.equal(maya?.openBalance, 240);
  assert.equal(maya?.unreadMessages, 1);
  assert.equal(maya?.documentCount, 1);
  assert.equal(maya?.nextBooking?.id, "b1");
});

test("a quiet workspace produces a clear state without invented tasks", () => {
  const snapshot = buildSoloOperatorSnapshot(baseState(), new Date("2026-07-20T09:00:00.000Z"));

  assert.deepEqual(snapshot.actions, []);
  assert.equal(snapshot.status, "clear");
  assert.equal(snapshot.metrics.outstandingAmount, 0);
});
