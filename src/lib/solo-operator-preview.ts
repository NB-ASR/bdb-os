import type { BdbState } from "./types";
import { generalBusinessBlueprint } from "./sector-packs";

function dateKey(date: Date) {
  return date.toLocaleDateString("en-CA");
}

function isoAt(date: Date, hours: number, minutes = 0) {
  const value = new Date(date);
  value.setHours(hours, minutes, 0, 0);
  return value.toISOString();
}

function addDays(date: Date, days: number) {
  const value = new Date(date);
  value.setDate(value.getDate() + days);
  return value;
}

export function buildSoloOperatorPreviewState(now = new Date()): BdbState {
  const yesterday = addDays(now, -1);
  const tomorrow = addDays(now, 1);
  const nextWeek = addDays(now, 6);

  return {
    blueprint: {
      ...generalBusinessBlueprint,
      key: "wellness-studio",
      name: "Wellness Studio",
      sector: "Wellness",
      description: "Booking-led workspace for a solo wellness and advisory operator.",
      labels: {
        ...generalBusinessBlueprint.labels,
        customerSingular: "Client",
        customerPlural: "Clients",
        appointmentSingular: "Session",
        appointmentPlural: "Sessions",
      },
      workflows: [
        "appointment-reminders",
        "missed-appointment-follow-up",
        "new-enquiry-triage",
        "overdue-invoice-follow-up",
        "client-onboarding",
      ],
    },
    theme: {
      preset: "obsidian-gold",
      mode: "dark",
      accentColor: "#d4a852",
      fontFamily: "manrope",
      textScale: 1,
      density: "comfortable",
      highContrast: false,
      reducedMotion: false,
    },
    settings: {
      businessName: "Northline Studio",
      ownerName: "Alex",
      email: "alex@northline.example",
      phone: "+356 2000 0000",
      currency: "EUR",
      invoicePrefix: "NLS",
      vatRate: 18,
    },
    customers: [
      { id: "solo-c1", code: "CL-1048", name: "Maya Borg", company: "Maya Borg Consulting", email: "maya@example.com", phone: "+356 7900 1001", address: "Valletta", notes: "Prefers WhatsApp and morning appointments.", createdAt: addDays(now, -44).toISOString() },
      { id: "solo-c2", code: "CL-1049", name: "Luke Vella", company: "Vella Property", email: "luke@example.com", phone: "+356 7900 1002", address: "Sliema", notes: "Monthly strategy session. Payment terms: 14 days.", createdAt: addDays(now, -28).toISOString() },
      { id: "solo-c3", code: "CL-1050", name: "Nina Camilleri", company: "Nina Wellness", email: "nina@example.com", phone: "+356 7900 1003", address: "Mosta", notes: "New enquiry from website.", createdAt: addDays(now, -3).toISOString() },
      { id: "solo-c4", code: "CL-1051", name: "Daniel Mifsud", company: "Mifsud Design", email: "daniel@example.com", phone: "+356 7900 1004", address: "Rabat", notes: "Quarterly review customer.", createdAt: addDays(now, -62).toISOString() },
    ],
    invoices: [
      { id: "solo-i1", number: "NLS-1042", customerId: "solo-c2", issuedAt: addDays(now, -23).toISOString().slice(0, 10), dueAt: addDays(now, -9).toISOString().slice(0, 10), description: "Monthly advisory retainer", amount: 680, status: "overdue" },
      { id: "solo-i2", number: "NLS-1045", customerId: "solo-c1", issuedAt: addDays(now, -7).toISOString().slice(0, 10), dueAt: nextWeek.toISOString().slice(0, 10), description: "Workshop and follow-up", amount: 420, status: "sent" },
      { id: "solo-i3", number: "NLS-1041", customerId: "solo-c4", issuedAt: addDays(now, -30).toISOString().slice(0, 10), dueAt: addDays(now, -16).toISOString().slice(0, 10), description: "Quarterly review", amount: 540, status: "paid" },
    ],
    bookings: [
      { id: "solo-b1", customerId: "solo-c1", title: "Project workshop", date: dateKey(now), time: "10:30", duration: 90, staff: "Alex", status: "confirmed" },
      { id: "solo-b2", customerId: "solo-c3", title: "New client consultation", date: dateKey(now), time: "15:00", duration: 45, staff: "Alex", status: "pending" },
      { id: "solo-b3", customerId: "solo-c2", title: "Monthly strategy session", date: dateKey(tomorrow), time: "11:00", duration: 60, staff: "Alex", status: "confirmed" },
      { id: "solo-b4", customerId: "solo-c4", title: "Quarterly planning call", date: dateKey(nextWeek), time: "09:30", duration: 60, staff: "Alex", status: "confirmed" },
    ],
    messages: [
      { id: "solo-m1", customerId: "solo-c3", channel: "Web", subject: "Can we move today's consultation?", preview: "I may need 16:00 instead. Would that still work?", timestamp: isoAt(now, 7, 48), unread: true, status: "approval" },
      { id: "solo-m2", customerId: "solo-c1", channel: "WhatsApp", subject: "Workshop documents", preview: "I uploaded the final brief. See you this morning.", timestamp: isoAt(now, 8, 16), unread: true, status: "open" },
      { id: "solo-m3", customerId: "solo-c2", channel: "Email", subject: "Invoice NLS-1042", preview: "I will check this with accounts and come back to you.", timestamp: isoAt(yesterday, 16, 22), unread: false, status: "replied" },
      { id: "solo-m4", customerId: "solo-c4", channel: "Email", subject: "Quarterly review confirmed", preview: "The date works. Please send the agenda when ready.", timestamp: isoAt(addDays(now, -2), 11, 12), unread: false, status: "replied" },
    ],
    documents: [
      { id: "solo-d1", name: "Maya-Borg-workshop-brief.pdf", type: "PDF", size: "1.4 MB", customerId: "solo-c1", linkedTo: "Maya Borg · Project workshop", uploadedAt: isoAt(now, 8, 12) },
      { id: "solo-d2", name: "Vella-Property-service-agreement.pdf", type: "PDF", size: "820 KB", customerId: "solo-c2", linkedTo: "Luke Vella · Customer record", uploadedAt: addDays(now, -21).toISOString() },
      { id: "solo-d3", name: "Receipt-software-subscription.pdf", type: "Receipt", size: "310 KB", linkedTo: "Business expense", uploadedAt: addDays(now, -4).toISOString() },
    ],
    transactions: [
      { id: "solo-t1", date: addDays(now, -2).toISOString().slice(0, 10), description: "Mifsud Design · NLS-1041", amount: 540, type: "credit", status: "matched", matchedInvoiceId: "solo-i3" },
      { id: "solo-t2", date: addDays(now, -4).toISOString().slice(0, 10), description: "Software subscription", amount: 49, type: "debit", status: "review" },
    ],
    automations: [],
    activity: [
      { id: "solo-a1", action: "Document connected", detail: "Maya-Borg-workshop-brief.pdf linked to today's workshop", timestamp: isoAt(now, 8, 13), tone: "blue" },
      { id: "solo-a2", action: "Customer message received", detail: "Nina requested a possible appointment change", timestamp: isoAt(now, 7, 48), tone: "gold" },
      { id: "solo-a3", action: "Payment matched", detail: "NLS-1041 matched to the Mifsud Design payment", timestamp: addDays(now, -2).toISOString(), tone: "green" },
    ],
  };
}
