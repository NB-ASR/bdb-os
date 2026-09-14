export type CustomerRegisterPageMeta = {
  number: number;
  limit: number;
  totalFiltered: number;
  totalPages: number;
  hasPrevious: boolean;
  hasNext: boolean;
};

type CachedRegisterPage<T> = {
  workspaceId: string;
  filter: string;
  search: string;
  page: number;
  items: T[];
  meta: CustomerRegisterPageMeta;
  cachedAt: string;
};

const CACHE_KEY = "bdb-customer-register-pages-v1";
const MAX_PAGES_PER_WORKSPACE = 20;
const MAX_TOTAL_PAGES = 60;

function normaliseSearch(search: string) {
  return search.trim().toLowerCase();
}

function readAll<T>(): CachedRegisterPage<T>[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(CACHE_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed as CachedRegisterPage<T>[] : [];
  } catch {
    return [];
  }
}

function writeAll<T>(pages: CachedRegisterPage<T>[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(pages.slice(0, MAX_TOTAL_PAGES)));
}

export function readCustomerRegisterPage<T>(
  workspaceId: string,
  filter: string,
  search: string,
  page: number,
) {
  const normalisedSearch = normaliseSearch(search);
  return readAll<T>().find((entry) =>
    entry.workspaceId === workspaceId
    && entry.filter === filter
    && entry.search === normalisedSearch
    && entry.page === page,
  ) ?? null;
}

export function writeCustomerRegisterPage<T>(
  workspaceId: string,
  filter: string,
  search: string,
  page: number,
  items: T[],
  meta: CustomerRegisterPageMeta,
) {
  const normalisedSearch = normaliseSearch(search);
  const next: CachedRegisterPage<T> = {
    workspaceId,
    filter,
    search: normalisedSearch,
    page,
    items,
    meta,
    cachedAt: new Date().toISOString(),
  };
  const current = readAll<T>().filter((entry) => !(
    entry.workspaceId === workspaceId
    && entry.filter === filter
    && entry.search === normalisedSearch
    && entry.page === page
  ));
  const workspacePages = current.filter((entry) => entry.workspaceId === workspaceId);
  const otherPages = current.filter((entry) => entry.workspaceId !== workspaceId);
  writeAll([next, ...workspacePages].slice(0, MAX_PAGES_PER_WORKSPACE).concat(otherPages));
}

export function invalidateCustomerRegisterPages(workspaceId: string) {
  const current = readAll<unknown>();
  const next = current.filter((entry) => entry.workspaceId !== workspaceId);
  if (next.length === current.length) return;
  writeAll(next);
}