export const featureKeys = [
  "overview",
  "accounts",
  "customers",
  "calendar",
  "communications",
  "documents",
  "banking",
  "reports",
  "automation",
  "activity",
  "appearance",
  "mobile_app",
  "team_members",
] as const;

export type FeatureKey = (typeof featureKeys)[number];
export type PlanCode = "starter" | "growth" | "pro";
export type WorkspaceRole = "owner" | "admin" | "manager" | "staff" | "viewer";
export type ThemePreset = "bdb" | "slate" | "ocean" | "forest" | "plum" | "custom";
export type ThemeMode = "dark" | "light" | "system";
export type ThemeFont = "manrope" | "dm-sans" | "system" | "serif";
export type ThemeDensity = "compact" | "comfortable" | "spacious";

export interface WorkspaceTheme {
  preset: ThemePreset;
  mode: ThemeMode;
  accentColor: string;
  fontFamily: ThemeFont;
  textScale: number;
  density: ThemeDensity;
  highContrast: boolean;
  reducedMotion: boolean;
  clientLogoPath?: string | null;
}

export interface WorkspaceIdentity {
  id: string;
  name: string;
  slug: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  planCode: PlanCode;
  planName: string;
}

export interface WorkspaceUser {
  id: string;
  email: string;
  name: string;
}

export interface SaasContextState {
  mode: "demo" | "live";
  loading: boolean;
  error: string | null;
  user: WorkspaceUser | null;
  workspace: WorkspaceIdentity | null;
  role: WorkspaceRole | null;
  entitlements: Record<FeatureKey, boolean>;
  theme: WorkspaceTheme;
  isPlatformAdmin: boolean;
}
