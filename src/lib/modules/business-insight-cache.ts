export type BusinessInsightSurface = "hub" | "reports";

export type BusinessInsightCache<T> = {
  workspaceId: string;
  surface: BusinessInsightSurface;
  cachedAt: string;
  payload: T;
};

const PREFIX = "bdb-business-insight-v1";
const LAST_WORKSPACE_KEY = `${PREFIX}:last-workspace`;

function key(surface: BusinessInsightSurface, workspaceId: string) {
  return `${PREFIX}:${surface}:${workspaceId}`;
}

export function readLastBusinessInsightWorkspace() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(LAST_WORKSPACE_KEY) ?? "";
}

export function readBusinessInsightCache<T>(surface: BusinessInsightSurface, workspaceId: string) {
  if (typeof window === "undefined" || !workspaceId) return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(key(surface, workspaceId)) ?? "null") as BusinessInsightCache<T> | null;
    if (!value || value.workspaceId !== workspaceId || value.surface !== surface) return null;
    return value;
  } catch {
    window.localStorage.removeItem(key(surface, workspaceId));
    return null;
  }
}

export function writeBusinessInsightCache<T>(surface: BusinessInsightSurface, workspaceId: string, payload: T) {
  if (typeof window === "undefined" || !workspaceId) return;
  const value: BusinessInsightCache<T> = {
    workspaceId,
    surface,
    cachedAt: new Date().toISOString(),
    payload,
  };
  window.localStorage.setItem(key(surface, workspaceId), JSON.stringify(value));
  window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}

export function clearBusinessInsightCache(surface: BusinessInsightSurface, workspaceId: string) {
  if (typeof window === "undefined" || !workspaceId) return;
  window.localStorage.removeItem(key(surface, workspaceId));
}
