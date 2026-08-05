const PREFIX = "bdb-workspace-settings-v1";
const LAST_WORKSPACE_KEY = `${PREFIX}:last-workspace`;

function cacheKey(workspaceId: string) {
  return `${PREFIX}:${workspaceId}`;
}

export function writeWorkspaceSettingsCache<T extends { workspaceId: string }>(value: T) {
  if (typeof window === "undefined" || !value.workspaceId) return;
  window.localStorage.setItem(cacheKey(value.workspaceId), JSON.stringify(value));
  window.localStorage.setItem(LAST_WORKSPACE_KEY, value.workspaceId);
}

export function readWorkspaceSettingsCache<T>(workspaceId: string): T | null {
  if (typeof window === "undefined" || !workspaceId) return null;
  try {
    const value = window.localStorage.getItem(cacheKey(workspaceId));
    return value ? JSON.parse(value) as T : null;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return null;
  }
}

export function readLastWorkspaceSettingsCache<T>(): T | null {
  if (typeof window === "undefined") return null;
  const workspaceId = window.localStorage.getItem(LAST_WORKSPACE_KEY);
  return workspaceId ? readWorkspaceSettingsCache<T>(workspaceId) : null;
}
