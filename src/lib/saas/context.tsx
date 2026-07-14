"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { isDemoMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";
import { allEntitlements, defaultTheme } from "./catalog";
import { featureKeys, type FeatureKey, type SaasContextState, type WorkspaceTheme } from "./types";

const THEME_KEY = "bdb-os-theme-v2";

const demoState: SaasContextState = {
  mode: "demo",
  loading: false,
  error: null,
  user: { id: "demo-user", email: "demo@bdb-os.co.uk", name: "Nicholas" },
  workspace: { id: "demo-workspace", name: "Northstar Studio", slug: "northstar-studio", status: "trial", planCode: "pro", planName: "Pro" },
  role: "owner",
  entitlements: allEntitlements,
  theme: defaultTheme,
  isPlatformAdmin: true,
};

interface SaasValue extends SaasContextState {
  hasFeature: (feature: FeatureKey) => boolean;
  updateTheme: (theme: WorkspaceTheme) => Promise<{ error?: string }>;
  refresh: () => Promise<void>;
}

const SaasContext = createContext<SaasValue | null>(null);

function normaliseTheme(input: Record<string, unknown> | null | undefined): WorkspaceTheme {
  if (!input) return defaultTheme;
  return {
    preset: (input.preset as WorkspaceTheme["preset"]) ?? defaultTheme.preset,
    mode: (input.mode as WorkspaceTheme["mode"]) ?? defaultTheme.mode,
    accentColor: (input.accent_color as string) ?? defaultTheme.accentColor,
    fontFamily: (input.font_family as WorkspaceTheme["fontFamily"]) ?? defaultTheme.fontFamily,
    textScale: Number(input.text_scale ?? defaultTheme.textScale),
    density: (input.density as WorkspaceTheme["density"]) ?? defaultTheme.density,
    highContrast: Boolean(input.high_contrast),
    reducedMotion: Boolean(input.reduced_motion),
    clientLogoPath: (input.client_logo_path as string | null) ?? null,
  };
}

function applyTheme(theme: WorkspaceTheme) {
  const root = document.documentElement;
  root.dataset.themeMode = theme.mode;
  root.dataset.themeFont = theme.fontFamily;
  root.dataset.themeDensity = theme.density;
  root.dataset.highContrast = String(theme.highContrast);
  root.dataset.reducedMotion = String(theme.reducedMotion);
  root.style.setProperty("--accent", theme.accentColor);
  root.style.setProperty("--gold", theme.accentColor);
  root.style.setProperty("--font-scale", String(theme.textScale));
  root.style.colorScheme = theme.mode === "system" ? "dark light" : theme.mode;
}

export function SaasProvider({ children }: { children: ReactNode }) {
  const demo = isDemoMode();
  const [state, setState] = useState<SaasContextState>(() => ({
    ...(demo ? demoState : { ...demoState, mode: "live" as const, loading: true, user: null, workspace: null, role: null, isPlatformAdmin: false }),
  }));

  const refresh = useCallback(async () => {
    if (demo) {
      let theme = defaultTheme;
      try {
        const saved = window.localStorage.getItem(THEME_KEY);
        if (saved) theme = { ...defaultTheme, ...JSON.parse(saved) as WorkspaceTheme };
      } catch {
        window.localStorage.removeItem(THEME_KEY);
      }
      setState({ ...demoState, theme });
      return;
    }

    const supabase = createClient();
    if (!supabase) return;
    setState((current) => ({ ...current, loading: true, error: null }));
    const [{ data: authData, error: authError }, { data: contextData, error: contextError }] = await Promise.all([
      supabase.auth.getUser(),
      supabase.rpc("get_my_workspace_context"),
    ]);

    if (authError || !authData.user) {
      setState((current) => ({ ...current, loading: false, error: authError?.message ?? "Your session has expired.", user: null }));
      return;
    }

    const context = contextData as {
      workspace?: { id: string; name: string; slug: string; status: "trial" | "active" | "suspended" | "cancelled"; planCode?: "starter" | "growth" | "pro"; planName?: string };
      membership?: { role?: SaasContextState["role"]; status?: string };
      theme?: Record<string, unknown>;
      features?: Partial<Record<FeatureKey, boolean>>;
      isPlatformAdmin?: boolean;
    } | null;

    if (contextError) {
      setState((current) => ({ ...current, loading: false, error: contextError.message }));
      return;
    }

    const entitlements = Object.fromEntries(featureKeys.map((key) => [key, Boolean(context?.features?.[key])])) as Record<FeatureKey, boolean>;
    const metadata = authData.user.user_metadata as { full_name?: string; name?: string } | undefined;
    setState({
      mode: "live",
      loading: false,
      error: null,
      user: {
        id: authData.user.id,
        email: authData.user.email ?? "",
        name: metadata?.full_name ?? metadata?.name ?? authData.user.email?.split("@")[0] ?? "BDB user",
      },
      workspace: context?.workspace ? {
        id: context.workspace.id,
        name: context.workspace.name,
        slug: context.workspace.slug,
        status: context.workspace.status,
        planCode: context.workspace.planCode ?? "starter",
        planName: context.workspace.planName ?? "Custom",
      } : null,
      role: context?.membership?.role ?? null,
      entitlements,
      theme: normaliseTheme(context?.theme),
      isPlatformAdmin: Boolean(context?.isPlatformAdmin),
    });
  }, [demo]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void refresh());
    return () => window.cancelAnimationFrame(frame);
  }, [refresh]);

  useEffect(() => {
    applyTheme(state.theme);
  }, [state.theme]);

  const updateTheme = useCallback(async (theme: WorkspaceTheme) => {
    setState((current) => ({ ...current, theme }));
    applyTheme(theme);
    if (demo) {
      window.localStorage.setItem(THEME_KEY, JSON.stringify(theme));
      return {};
    }

    const supabase = createClient();
    if (!supabase || !state.workspace || !state.user) return { error: "Workspace is not ready." };
    const { error } = await supabase.from("workspace_themes").update({
      preset: theme.preset,
      mode: theme.mode,
      accent_color: theme.accentColor,
      font_family: theme.fontFamily,
      text_scale: theme.textScale,
      density: theme.density,
      high_contrast: theme.highContrast,
      reduced_motion: theme.reducedMotion,
      client_logo_path: theme.clientLogoPath ?? null,
      updated_by: state.user.id,
    }).eq("workspace_id", state.workspace.id);
    return error ? { error: error.message } : {};
  }, [demo, state.user, state.workspace]);

  const value = useMemo<SaasValue>(() => ({
    ...state,
    hasFeature: (feature) => state.isPlatformAdmin || state.entitlements[feature],
    updateTheme,
    refresh,
  }), [refresh, state, updateTheme]);

  return <SaasContext.Provider value={value}>{children}</SaasContext.Provider>;
}

export function useSaas() {
  const context = useContext(SaasContext);
  if (!context) throw new Error("useSaas must be used inside SaasProvider");
  return context;
}

export function themePreviewStyle(theme: WorkspaceTheme): CSSProperties {
  return { "--theme-preview": theme.accentColor } as CSSProperties;
}
