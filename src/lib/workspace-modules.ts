export const workspaceModuleIds = [
  "accounts",
  "customers",
  "calendar",
  "communications",
  "documents",
  "banking",
  "reports",
  "automation",
  "sales",
  "inventory",
] as const;

export type WorkspaceModuleId = (typeof workspaceModuleIds)[number];

export const workspaceModuleIconKeys = [
  "accounts",
  "customers",
  "calendar",
  "communications",
  "documents",
  "banking",
  "reports",
  "automation",
  "sales",
  "inventory",
] as const;

export type WorkspaceModuleIconKey = (typeof workspaceModuleIconKeys)[number];
export type WorkspaceModuleAvailability = "available" | "planned";
export type OfflineCapability = "full" | "cached-read" | "cloud-required";

export interface WorkspaceModuleDefinition {
  id: WorkspaceModuleId;
  name: string;
  shortName: string;
  description: string;
  href: string;
  icon: WorkspaceModuleIconKey;
  availability: WorkspaceModuleAvailability;
  owningRecord: string;
  connectsTo: readonly string[];
  offlineCapability: OfflineCapability;
}

export const workspaceModuleCatalogue = {
  accounts: {
    id: "accounts",
    name: "Accounts",
    shortName: "Accounts",
    description: "Invoices, payments and reconciliation",
    href: "/accounts",
    icon: "accounts",
    availability: "available",
    owningRecord: "invoice",
    connectsTo: ["customer", "payment", "bank transaction", "document", "activity"],
    offlineCapability: "cached-read",
  },
  customers: {
    id: "customers",
    name: "Customers",
    shortName: "Customers",
    description: "Every relationship in one record",
    href: "/customers",
    icon: "customers",
    availability: "available",
    owningRecord: "customer",
    connectsTo: ["appointment", "invoice", "communication", "document", "note", "activity"],
    offlineCapability: "full",
  },
  calendar: {
    id: "calendar",
    name: "Calendar",
    shortName: "Calendar",
    description: "Bookings, people and availability",
    href: "/calendar",
    icon: "calendar",
    availability: "available",
    owningRecord: "appointment",
    connectsTo: ["customer", "service", "staff", "communication", "invoice", "activity"],
    offlineCapability: "full",
  },
  communications: {
    id: "communications",
    name: "Communications",
    shortName: "Comms",
    description: "One inbox across every channel",
    href: "/communications",
    icon: "communications",
    availability: "available",
    owningRecord: "conversation",
    connectsTo: ["customer", "appointment", "invoice", "document", "activity"],
    offlineCapability: "cached-read",
  },
  documents: {
    id: "documents",
    name: "Documents",
    shortName: "Documents",
    description: "Files connected to business records",
    href: "/documents",
    icon: "documents",
    availability: "available",
    owningRecord: "document",
    connectsTo: ["customer", "appointment", "invoice", "communication", "activity"],
    offlineCapability: "cached-read",
  },
  banking: {
    id: "banking",
    name: "Banking",
    shortName: "Banking",
    description: "Cash position and transaction matching",
    href: "/banking",
    icon: "banking",
    availability: "available",
    owningRecord: "bank transaction",
    connectsTo: ["invoice", "payment", "customer", "activity"],
    offlineCapability: "cached-read",
  },
  reports: {
    id: "reports",
    name: "Reports",
    shortName: "Reports",
    description: "Useful detail when you need it",
    href: "/reports",
    icon: "reports",
    availability: "available",
    owningRecord: "report",
    connectsTo: ["customer", "appointment", "invoice", "payment", "inventory movement"],
    offlineCapability: "cached-read",
  },
  automation: {
    id: "automation",
    name: "Automation",
    shortName: "Automation",
    description: "Smart assistance with human approval",
    href: "/automation-hub",
    icon: "automation",
    availability: "available",
    owningRecord: "automation rule",
    connectsTo: ["customer", "appointment", "invoice", "communication", "activity"],
    offlineCapability: "cloud-required",
  },
  sales: {
    id: "sales",
    name: "Sales",
    shortName: "Sales",
    description: "Leads, quotes, orders and follow-up",
    href: "/sales",
    icon: "sales",
    availability: "planned",
    owningRecord: "sales opportunity",
    connectsTo: ["customer", "quote", "order", "invoice", "communication", "activity"],
    offlineCapability: "full",
  },
  inventory: {
    id: "inventory",
    name: "Inventory",
    shortName: "Inventory",
    description: "Products, supplies and stock movement",
    href: "/inventory",
    icon: "inventory",
    availability: "available",
    owningRecord: "inventory item",
    connectsTo: ["supplier", "sale", "appointment", "invoice", "inventory movement", "activity"],
    offlineCapability: "full",
  },
} as const satisfies Record<WorkspaceModuleId, WorkspaceModuleDefinition>;

export function getWorkspaceModule(moduleId: WorkspaceModuleId): WorkspaceModuleDefinition {
  return workspaceModuleCatalogue[moduleId];
}
