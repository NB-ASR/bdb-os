import {
  getWorkspaceModule,
  type WorkspaceModuleDefinition,
  type WorkspaceModuleId,
} from "./workspace-modules.ts";

export const industryTemplateIds = ["general", "beauty-wellness"] as const;
export type IndustryTemplateId = (typeof industryTemplateIds)[number];

export type WorkspaceTerminologyKey =
  | "customer"
  | "appointment"
  | "service"
  | "staffMember"
  | "inventoryItem";

export type WorkspaceTerminology = Record<WorkspaceTerminologyKey, string>;

export interface IndustryWorkspaceTemplate {
  id: IndustryTemplateId;
  name: string;
  description: string;
  activeModules: readonly WorkspaceModuleId[];
  recommendedModules: readonly WorkspaceModuleId[];
  terminology: WorkspaceTerminology;
  exampleWorkspace?: string;
}

const coreActiveModules = [
  "accounts",
  "customers",
  "calendar",
  "communications",
  "documents",
  "banking",
  "reports",
  "automation",
] as const satisfies readonly WorkspaceModuleId[];

export const industryWorkspaceTemplates = {
  general: {
    id: "general",
    name: "General business",
    description: "The neutral BDB OS workspace for businesses without an industry-specific template.",
    activeModules: coreActiveModules,
    recommendedModules: [],
    terminology: {
      customer: "Customer",
      appointment: "Appointment",
      service: "Service",
      staffMember: "Staff member",
      inventoryItem: "Inventory item",
    },
  },
  "beauty-wellness": {
    id: "beauty-wellness",
    name: "Beauty & Wellness",
    description: "A reusable workspace template for salons, spas, clinics and wellness providers.",
    activeModules: coreActiveModules,
    recommendedModules: ["sales", "inventory"],
    terminology: {
      customer: "Client",
      appointment: "Booking",
      service: "Treatment",
      staffMember: "Therapist",
      inventoryItem: "Product",
    },
    exampleWorkspace: "Vanita Beauty and Wellness Spa",
  },
} as const satisfies Record<IndustryTemplateId, IndustryWorkspaceTemplate>;

export function resolveIndustryTemplate(templateId?: string): IndustryWorkspaceTemplate {
  if (templateId && industryTemplateIds.includes(templateId as IndustryTemplateId)) {
    return industryWorkspaceTemplates[templateId as IndustryTemplateId];
  }

  return industryWorkspaceTemplates.general;
}

export function getWorkspaceModules(
  templateId?: string,
  options: { includePlanned?: boolean } = {},
): WorkspaceModuleDefinition[] {
  const template = resolveIndustryTemplate(templateId);
  const moduleIds = options.includePlanned
    ? [...template.activeModules, ...template.recommendedModules]
    : [...template.activeModules];

  return [...new Set(moduleIds)]
    .map((moduleId) => getWorkspaceModule(moduleId))
    .filter((module) => options.includePlanned || module.availability === "available");
}

export function getTemplateTerminology(
  templateId: string | undefined,
  key: WorkspaceTerminologyKey,
): string {
  return resolveIndustryTemplate(templateId).terminology[key];
}
