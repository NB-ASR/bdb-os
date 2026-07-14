import type { FeatureKey, PlanCode, ThemePreset, WorkspaceTheme } from "./types";

export const featureCatalog: Array<{
  key: FeatureKey;
  name: string;
  shortName: string;
  description: string;
}> = [
  { key: "overview", name: "Business overview", shortName: "Overview", description: "Daily priorities and business health at a glance." },
  { key: "accounts", name: "Accounts & invoicing", shortName: "Accounts", description: "Invoices, payments and financial records." },
  { key: "customers", name: "Customer workspace", shortName: "Customers", description: "Connected customer and company records." },
  { key: "calendar", name: "Calendar & appointments", shortName: "Calendar", description: "Appointments, staff and availability." },
  { key: "communications", name: "Unified communications", shortName: "Communications", description: "One inbox with assisted drafts and approvals." },
  { key: "documents", name: "Connected documents", shortName: "Documents", description: "Files linked to customers and work." },
  { key: "banking", name: "Banking & reconciliation", shortName: "Banking", description: "Transaction review and payment matching." },
  { key: "reports", name: "Reports & insights", shortName: "Reports", description: "Performance, cash and operational reporting." },
  { key: "automation", name: "Business automation", shortName: "Automation", description: "Assisted workflows with human approval." },
  { key: "activity", name: "Activity history", shortName: "Activity", description: "A traceable workspace activity trail." },
  { key: "appearance", name: "Custom appearance", shortName: "Appearance", description: "Themes, density, type and accessibility controls." },
  { key: "mobile_app", name: "Mobile experience", shortName: "Mobile", description: "An installable workspace designed for work on the move." },
  { key: "team_members", name: "Team access", shortName: "Team", description: "Invite staff with managed access levels." },
];

export const planCatalog: Array<{
  code: PlanCode;
  name: string;
  strapline: string;
  description: string;
  features: FeatureKey[];
}> = [
  {
    code: "starter",
    name: "Starter",
    strapline: "A clear place to begin",
    description: "The essentials for a business ready to organise customers, appointments and everyday records.",
    features: ["overview", "customers", "calendar", "documents", "activity", "appearance"],
  },
  {
    code: "growth",
    name: "Growth",
    strapline: "Connected work, less admin",
    description: "A joined-up operating system with finance, communications, reporting and useful automation.",
    features: ["overview", "accounts", "customers", "calendar", "communications", "documents", "reports", "automation", "activity", "appearance", "mobile_app"],
  },
  {
    code: "pro",
    name: "Pro",
    strapline: "The complete BDB OS",
    description: "Every module, broader team access and maximum room for a completely tailored setup.",
    features: featureCatalog.map((feature) => feature.key),
  },
];

export const themePresets: Record<Exclude<ThemePreset, "custom">, Pick<WorkspaceTheme, "accentColor" | "mode"> & { label: string; preview: string }> = {
  bdb: { label: "BDB Black & Gold", accentColor: "#d3a84b", mode: "dark", preview: "#d3a84b" },
  slate: { label: "Executive Slate", accentColor: "#8da2bd", mode: "dark", preview: "#8da2bd" },
  ocean: { label: "Clear Ocean", accentColor: "#3f9fd6", mode: "light", preview: "#3f9fd6" },
  forest: { label: "Modern Forest", accentColor: "#4eaa7b", mode: "light", preview: "#4eaa7b" },
  plum: { label: "Deep Plum", accentColor: "#b683cf", mode: "dark", preview: "#b683cf" },
};

export const defaultTheme: WorkspaceTheme = {
  preset: "bdb",
  mode: "dark",
  accentColor: "#d3a84b",
  fontFamily: "manrope",
  textScale: 1,
  density: "comfortable",
  highContrast: false,
  reducedMotion: false,
  clientLogoPath: null,
};

export const allEntitlements = Object.fromEntries(
  featureCatalog.map((feature) => [feature.key, true]),
) as Record<FeatureKey, boolean>;
