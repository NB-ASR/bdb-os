import type { BdbState } from "./types";

export const seedState: BdbState = {
  theme: {
    preset: "obsidian-gold",
    mode: "dark",
    accentColor: "#d3a84b",
    fontFamily: "manrope",
    textScale: 1,
    density: "comfortable",
    highContrast: false,
    reducedMotion: false,
  },
  settings: {
    businessName: "BDB OS",
    ownerName: "Owner",
    email: "",
    phone: "",
    currency: "EUR",
    invoicePrefix: "BDB",
    vatRate: 18,
  },
  customers: [],
  invoices: [],
  bookings: [],
  messages: [],
  documents: [],
  transactions: [],
  automations: [],
  activity: [],
};
