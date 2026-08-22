export type AccountsCachedWorkspaceContext = {
  currentWorkspaceId: string;
  supportAccess: boolean;
  supportAccessMode: string | null;
  cachedAt: string;
};

export type AccountsCachedSettings = {
  currency: string;
  business_address: string | null;
  vat_number: string | null;
  company_registration_number: string | null;
  payment_terms_days: number;
};

export type AccountsCachedCustomer = {
  id: string;
  code: string;
  name: string;
  company: string | null;
  email: string | null;
  address: string | null;
  vat_number: string | null;
};

export type AccountsCachedCatalogueItem = {
  id: string;
  type: "product" | "service";
  code: string;
  name: string;
  unitPrice: number | null;
  vatRate: number;
};

export type AccountsCachedPaymentDetail = {
  paymentId: string;
  cachedAt: string;
  bundle: Record<string, unknown>;
};

type WorkspaceCache = {
  version: 1;
  workspaceId: string;
  updatedAt: string;
  settings: AccountsCachedSettings | null;
  customers: AccountsCachedCustomer[];
  catalogue: AccountsCachedCatalogueItem[];
  paymentDetails: AccountsCachedPaymentDetail[];
};

const CONTEXT_KEY = "bdb-accounts-context-v1";
const WORKSPACE_PREFIX = "bdb-accounts-working-cache-v1";
const CUSTOMER_LIMIT = 100;
const CATALOGUE_LIMIT = 150;
const PAYMENT_DETAIL_LIMIT = 20;

function workspaceKey(workspaceId: string) {
  return `${WORKSPACE_PREFIX}:${workspaceId}`;
}

function safeParse<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function readWorkspace(workspaceId: string): WorkspaceCache {
  const empty: WorkspaceCache = {
    version: 1,
    workspaceId,
    updatedAt: new Date(0).toISOString(),
    settings: null,
    customers: [],
    catalogue: [],
    paymentDetails: [],
  };
  if (typeof window === "undefined" || !workspaceId) return empty;
  const parsed = safeParse<WorkspaceCache>(window.localStorage.getItem(workspaceKey(workspaceId)));
  if (!parsed || parsed.version !== 1 || parsed.workspaceId !== workspaceId) return empty;
  return {
    ...empty,
    ...parsed,
    customers: Array.isArray(parsed.customers) ? parsed.customers.slice(0, CUSTOMER_LIMIT) : [],
    catalogue: Array.isArray(parsed.catalogue) ? parsed.catalogue.slice(0, CATALOGUE_LIMIT) : [],
    paymentDetails: Array.isArray(parsed.paymentDetails) ? parsed.paymentDetails.slice(0, PAYMENT_DETAIL_LIMIT) : [],
  };
}

function writeWorkspace(cache: WorkspaceCache) {
  if (typeof window === "undefined" || !cache.workspaceId) return;
  const bounded: WorkspaceCache = {
    ...cache,
    version: 1,
    updatedAt: new Date().toISOString(),
    customers: cache.customers.slice(0, CUSTOMER_LIMIT),
    catalogue: cache.catalogue.slice(0, CATALOGUE_LIMIT),
    paymentDetails: cache.paymentDetails.slice(0, PAYMENT_DETAIL_LIMIT),
  };
  window.localStorage.setItem(workspaceKey(cache.workspaceId), JSON.stringify(bounded));
}

function searchable(value: unknown) {
  return String(value ?? "").toLocaleLowerCase();
}

export function cacheAccountsWorkspaceContext(value: {
  currentWorkspaceId?: unknown;
  supportAccess?: unknown;
  supportAccessMode?: unknown;
}) {
  if (typeof window === "undefined") return;
  const currentWorkspaceId = String(value.currentWorkspaceId ?? "").trim();
  if (!currentWorkspaceId) return;
  const context: AccountsCachedWorkspaceContext = {
    currentWorkspaceId,
    supportAccess: Boolean(value.supportAccess),
    supportAccessMode: value.supportAccessMode == null ? null : String(value.supportAccessMode),
    cachedAt: new Date().toISOString(),
  };
  window.localStorage.setItem(CONTEXT_KEY, JSON.stringify(context));
}

export function readAccountsWorkspaceContext(): AccountsCachedWorkspaceContext | null {
  if (typeof window === "undefined") return null;
  const parsed = safeParse<AccountsCachedWorkspaceContext>(window.localStorage.getItem(CONTEXT_KEY));
  if (!parsed?.currentWorkspaceId || !parsed.cachedAt) return null;
  return parsed;
}

export function cacheAccountsSettings(workspaceId: string, settings: AccountsCachedSettings) {
  const cache = readWorkspace(workspaceId);
  writeWorkspace({ ...cache, settings });
}

export function readAccountsSettings(workspaceId: string) {
  return readWorkspace(workspaceId).settings;
}

export function cacheAccountsCustomers(workspaceId: string, customers: readonly AccountsCachedCustomer[]) {
  const cache = readWorkspace(workspaceId);
  const byId = new Map(cache.customers.map((customer) => [customer.id, customer]));
  for (const customer of customers) byId.set(customer.id, customer);
  const merged = [...customers, ...cache.customers.filter((customer) => !customers.some((incoming) => incoming.id === customer.id))];
  writeWorkspace({ ...cache, customers: merged.map((customer) => byId.get(customer.id) ?? customer) });
}

export function searchAccountsCustomers(workspaceId: string, query: string, limit = 25) {
  const q = query.trim().toLocaleLowerCase();
  return readWorkspace(workspaceId).customers
    .filter((customer) => !q || [customer.name, customer.code, customer.company].some((value) => searchable(value).includes(q)))
    .slice(0, Math.min(Math.max(limit, 1), 25));
}

export function cacheAccountsCatalogue(workspaceId: string, items: readonly AccountsCachedCatalogueItem[]) {
  const cache = readWorkspace(workspaceId);
  const key = (item: AccountsCachedCatalogueItem) => `${item.type}:${item.id}`;
  const incoming = new Set(items.map(key));
  const merged = [...items, ...cache.catalogue.filter((item) => !incoming.has(key(item)))];
  writeWorkspace({ ...cache, catalogue: merged });
}

export function searchAccountsCatalogue(
  workspaceId: string,
  query: string,
  kind: "all" | "product" | "service" = "all",
  limit = 50,
) {
  const q = query.trim().toLocaleLowerCase();
  return readWorkspace(workspaceId).catalogue
    .filter((item) => kind === "all" || item.type === kind)
    .filter((item) => !q || [item.code, item.name].some((value) => searchable(value).includes(q)))
    .slice(0, Math.min(Math.max(limit, 1), 50));
}

export function cacheAccountsPaymentDetail(workspaceId: string, paymentId: string, bundle: Record<string, unknown>) {
  const cache = readWorkspace(workspaceId);
  const next: AccountsCachedPaymentDetail = { paymentId, cachedAt: new Date().toISOString(), bundle };
  writeWorkspace({
    ...cache,
    paymentDetails: [next, ...cache.paymentDetails.filter((item) => item.paymentId !== paymentId)],
  });
}

export function readAccountsPaymentDetail(workspaceId: string, paymentId: string) {
  return readWorkspace(workspaceId).paymentDetails.find((item) => item.paymentId === paymentId) ?? null;
}
