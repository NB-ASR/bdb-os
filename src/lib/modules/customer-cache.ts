export type CachedCustomer = {
  id: string;
  pending?: boolean;
  [key: string]: unknown;
};

export type CachedCustomerSummary = {
  activeCount: number;
  archivedCount: number;
  importedCount: number;
  companyCount: number;
};

const CACHE_PREFIX = "bdb-customers-cache-v2";
const SUMMARY_PREFIX = "bdb-customers-summary-v1";
const LEGACY_CACHE_PREFIX = "bdb-customers-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-customers-last-workspace-v1";
export const CUSTOMER_CACHE_LIMIT = 300;

function storageKey(workspaceId: string) {
  return `${CACHE_PREFIX}:${workspaceId}`;
}

function summaryKey(workspaceId: string) {
  return `${SUMMARY_PREFIX}:${workspaceId}`;
}

function legacyStorageKey(workspaceId: string) {
  return `${LEGACY_CACHE_PREFIX}:${workspaceId}`;
}

export function readLastCustomerWorkspace() {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(LAST_WORKSPACE_KEY);
}

export function rememberCustomerWorkspace(workspaceId: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(LAST_WORKSPACE_KEY, workspaceId);
}

function parseRows(value: string | null): CachedCustomer[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is CachedCustomer => Boolean(item) && typeof item === "object" && !Array.isArray(item) && typeof (item as CachedCustomer).id === "string")
      .slice(0, CUSTOMER_CACHE_LIMIT);
  } catch {
    return [];
  }
}

export function readCustomerCache<T extends CachedCustomer = CachedCustomer>(workspaceId: string): T[] {
  if (typeof window === "undefined") return [];
  const current = parseRows(window.localStorage.getItem(storageKey(workspaceId)));
  if (current.length) return current as T[];

  const legacy = parseRows(window.localStorage.getItem(legacyStorageKey(workspaceId)));
  if (legacy.length) {
    writeCustomerCache(workspaceId, legacy);
    window.localStorage.removeItem(legacyStorageKey(workspaceId));
  }
  return legacy as T[];
}

export function readCustomerSummary(workspaceId: string): CachedCustomerSummary | null {
  if (typeof window === "undefined") return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(summaryKey(workspaceId)) ?? "null") as Partial<CachedCustomerSummary> | null;
    if (!parsed) return null;
    const values = [parsed.activeCount, parsed.archivedCount, parsed.importedCount, parsed.companyCount];
    if (values.some((value) => !Number.isFinite(value))) return null;
    return {
      activeCount: Number(parsed.activeCount),
      archivedCount: Number(parsed.archivedCount),
      importedCount: Number(parsed.importedCount),
      companyCount: Number(parsed.companyCount),
    };
  } catch {
    window.localStorage.removeItem(summaryKey(workspaceId));
    return null;
  }
}

export function writeCustomerSummary(workspaceId: string, summary: CachedCustomerSummary) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(summaryKey(workspaceId), JSON.stringify(summary));
}

function stripPending<T extends CachedCustomer>(row: T): T {
  const { pending: _pending, ...clean } = row;
  return clean as T;
}

export function writeCustomerCache<T extends CachedCustomer>(workspaceId: string, rows: readonly T[]) {
  if (typeof window === "undefined") return;
  const deduped = new Map<string, T>();
  for (const row of rows) {
    if (!deduped.has(row.id)) deduped.set(row.id, stripPending(row));
    if (deduped.size >= CUSTOMER_CACHE_LIMIT) break;
  }
  const bounded = [...deduped.values()];
  if (!bounded.length) {
    window.localStorage.removeItem(storageKey(workspaceId));
    return;
  }
  window.localStorage.setItem(storageKey(workspaceId), JSON.stringify(bounded));
}

export function mergeCustomerCache<T extends CachedCustomer>(workspaceId: string, incoming: readonly T[]) {
  const existing = readCustomerCache<T>(workspaceId);
  const merged = new Map<string, T>();
  for (const row of incoming) merged.set(row.id, stripPending(row));
  for (const row of existing) {
    if (!merged.has(row.id)) merged.set(row.id, stripPending(row));
    if (merged.size >= CUSTOMER_CACHE_LIMIT) break;
  }
  const bounded = [...merged.values()].slice(0, CUSTOMER_CACHE_LIMIT);
  writeCustomerCache(workspaceId, bounded);
  return bounded;
}
