export const workspaceModuleKeys = [
  "overview",
  "accounts",
  "customers",
  "calendar",
  "communications",
  "documents",
  "banking",
  "reports",
  "automation",
] as const;

export type WorkspaceModuleKey = (typeof workspaceModuleKeys)[number];

export const workflowKeys = [
  "appointment-reminders",
  "missed-appointment-follow-up",
  "new-enquiry-triage",
  "overdue-invoice-follow-up",
  "document-request-follow-up",
  "client-onboarding",
  "matter-deadline-review",
  "recurring-compliance-check",
] as const;

export type SectorWorkflowKey = (typeof workflowKeys)[number];

export const complianceKeys = [
  "consent-recording",
  "confidential-notes",
  "document-retention",
  "conflict-check",
  "engagement-letter",
  "identity-verification",
  "professional-review",
] as const;

export type ComplianceKey = (typeof complianceKeys)[number];

export interface WorkspaceBlueprint {
  key: string;
  name: string;
  sector: string;
  version: number;
  description: string;
  labels: {
    customerSingular: string;
    customerPlural: string;
    appointmentSingular: string;
    appointmentPlural: string;
    invoiceSingular: string;
    invoicePlural: string;
    documentSingular: string;
    documentPlural: string;
    navigation: Partial<Record<WorkspaceModuleKey, string>>;
  };
  navigation: {
    enabled: WorkspaceModuleKey[];
    emphasis: WorkspaceModuleKey[];
  };
  workflows: SectorWorkflowKey[];
  compliance: ComplianceKey[];
  dashboard: string[];
  recordFields: {
    customer: string[];
    appointment: string[];
    invoice: string[];
    document: string[];
  };
}

export type WorkspaceBlueprintOverrides = Partial<{
  labels: Partial<WorkspaceBlueprint["labels"]> & {
    navigation?: Partial<Record<WorkspaceModuleKey, string>>;
  };
  navigation: Partial<WorkspaceBlueprint["navigation"]>;
  workflows: SectorWorkflowKey[];
  compliance: ComplianceKey[];
  dashboard: string[];
  recordFields: Partial<WorkspaceBlueprint["recordFields"]>;
}>;

export const generalBusinessBlueprint: WorkspaceBlueprint = {
  key: "general-services",
  name: "General Services",
  sector: "General",
  version: 1,
  description: "Balanced BDB OS workspace for service businesses without a specialist sector pack.",
  labels: {
    customerSingular: "Customer",
    customerPlural: "Customers",
    appointmentSingular: "Appointment",
    appointmentPlural: "Appointments",
    invoiceSingular: "Invoice",
    invoicePlural: "Invoices",
    documentSingular: "Document",
    documentPlural: "Documents",
    navigation: {},
  },
  navigation: {
    enabled: [...workspaceModuleKeys],
    emphasis: ["overview", "customers", "calendar", "communications", "accounts"],
  },
  workflows: [
    "appointment-reminders",
    "new-enquiry-triage",
    "overdue-invoice-follow-up",
    "document-request-follow-up",
    "client-onboarding",
  ],
  compliance: ["document-retention"],
  dashboard: ["today", "communications", "appointments", "outstanding-balances", "documents"],
  recordFields: {
    customer: ["contact-details", "preferences", "notes"],
    appointment: ["date-time", "duration", "status"],
    invoice: ["issue-date", "due-date", "amount", "status"],
    document: ["type", "linked-record", "retention-status"],
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function mergeRecords(base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeRecords(current, value) : value;
  }
  return result;
}

function cleanWords(values: unknown, allowed?: readonly string[]) {
  if (!Array.isArray(values)) return [];
  const unique = [...new Set(values.map(String).map((value) => value.trim()).filter(Boolean))];
  return allowed ? unique.filter((value) => allowed.includes(value)) : unique;
}

export function normaliseWorkspaceBlueprint(value: unknown): WorkspaceBlueprint {
  const source = isRecord(value) ? value : {};
  const merged = mergeRecords(
    generalBusinessBlueprint as unknown as Record<string, unknown>,
    source,
  ) as unknown as WorkspaceBlueprint;

  const enabled = cleanWords(merged.navigation?.enabled, workspaceModuleKeys) as WorkspaceModuleKey[];
  const emphasis = cleanWords(merged.navigation?.emphasis, workspaceModuleKeys)
    .filter((key) => enabled.includes(key as WorkspaceModuleKey)) as WorkspaceModuleKey[];

  return {
    ...generalBusinessBlueprint,
    ...merged,
    key: String(merged.key || generalBusinessBlueprint.key).slice(0, 80),
    name: String(merged.name || generalBusinessBlueprint.name).slice(0, 120),
    sector: String(merged.sector || generalBusinessBlueprint.sector).slice(0, 80),
    version: Math.max(1, Number(merged.version) || 1),
    description: String(merged.description || generalBusinessBlueprint.description).slice(0, 600),
    labels: {
      ...generalBusinessBlueprint.labels,
      ...(merged.labels ?? {}),
      customerSingular: String(merged.labels?.customerSingular || "Customer").slice(0, 40),
      customerPlural: String(merged.labels?.customerPlural || "Customers").slice(0, 40),
      appointmentSingular: String(merged.labels?.appointmentSingular || "Appointment").slice(0, 40),
      appointmentPlural: String(merged.labels?.appointmentPlural || "Appointments").slice(0, 40),
      invoiceSingular: String(merged.labels?.invoiceSingular || "Invoice").slice(0, 40),
      invoicePlural: String(merged.labels?.invoicePlural || "Invoices").slice(0, 40),
      documentSingular: String(merged.labels?.documentSingular || "Document").slice(0, 40),
      documentPlural: String(merged.labels?.documentPlural || "Documents").slice(0, 40),
      navigation: isRecord(merged.labels?.navigation)
        ? Object.fromEntries(
            Object.entries(merged.labels.navigation)
              .filter(([key]) => workspaceModuleKeys.includes(key as WorkspaceModuleKey))
              .map(([key, label]) => [key, String(label).slice(0, 40)]),
          )
        : {},
    },
    navigation: {
      enabled: enabled.length ? enabled : [...generalBusinessBlueprint.navigation.enabled],
      emphasis,
    },
    workflows: cleanWords(merged.workflows, workflowKeys) as SectorWorkflowKey[],
    compliance: cleanWords(merged.compliance, complianceKeys) as ComplianceKey[],
    dashboard: cleanWords(merged.dashboard),
    recordFields: {
      customer: cleanWords(merged.recordFields?.customer),
      appointment: cleanWords(merged.recordFields?.appointment),
      invoice: cleanWords(merged.recordFields?.invoice),
      document: cleanWords(merged.recordFields?.document),
    },
  };
}

export function resolveWorkspaceBlueprint(
  template: unknown,
  overrides: unknown,
): WorkspaceBlueprint {
  const base = normaliseWorkspaceBlueprint(template);
  const resolved = mergeRecords(
    base as unknown as Record<string, unknown>,
    isRecord(overrides) ? overrides : {},
  );
  return normaliseWorkspaceBlueprint(resolved);
}

export function blueprintNavigationLabel(
  blueprint: WorkspaceBlueprint,
  key: WorkspaceModuleKey,
  fallback: string,
) {
  return blueprint.labels.navigation[key] || fallback;
}
