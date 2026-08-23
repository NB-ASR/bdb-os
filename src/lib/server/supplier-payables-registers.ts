import { Buffer } from "node:buffer";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CommandError } from "@/lib/server/command";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REGISTER_VIEWS = new Set([
  "bootstrap",
  "documents",
  "payables",
  "payments",
  "payment-allocations",
  "credit-allocations",
  "balances",
  "suppliers",
  "eligible",
]);

type DateCursor = { at: string; id: string };

function uuid(value: string | null, field: string) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", `${field} is invalid.`);
  }
  return result;
}

function pageSize(value: string | null, fallback = 50, maximum = 100) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(Math.max(parsed, 25), maximum);
}

function pageNumber(value: string | null) {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100_000) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", "Supplier Accounts page is invalid.");
  }
  return parsed;
}

function searchTerm(value: string | null) {
  const raw = String(value ?? "").trim().slice(0, 100);
  return raw.replace(/[^\p{L}\p{N}\s./-]/gu, " ").replace(/\s+/g, " ").trim();
}

function encodeCursor(at: string, id: string) {
  return Buffer.from(JSON.stringify({ at, id } satisfies DateCursor)).toString("base64url");
}

function decodeCursor(value: string | null): DateCursor | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Partial<DateCursor>;
    if (!decoded.at || Number.isNaN(Date.parse(decoded.at)) || !decoded.id || !UUID_PATTERN.test(decoded.id)) throw new Error("invalid");
    return { at: new Date(decoded.at).toISOString(), id: decoded.id };
  } catch {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_CURSOR", "Supplier Accounts page cursor is invalid.");
  }
}

function pageResult<T extends { id: string }>(rows: T[], limit: number, sortValue: (row: T) => string) {
  const hasMore = rows.length > limit;
  const visible = hasMore ? rows.slice(0, limit) : rows;
  const last = visible.at(-1);
  return {
    rows: visible,
    pageSize: limit,
    hasMore,
    nextCursor: hasMore && last ? encodeCursor(sortValue(last), last.id) : null,
  };
}

async function supplierMapForDocuments(
  supabase: SupabaseClient,
  workspaceId: string,
  documents: Array<{ supplier_id: string | null }>,
) {
  const ids = [...new Set(documents.map((document) => document.supplier_id).filter((id): id is string => Boolean(id)))];
  if (!ids.length) return new Map<string, { id: string; code: string; name: string }>();
  const result = await supabase
    .from("suppliers")
    .select("id,code,name")
    .eq("workspace_id", workspaceId)
    .in("id", ids);
  if (result.error) throw result.error;
  return new Map((result.data ?? []).map((supplier) => [supplier.id, supplier]));
}

async function bootstrap(supabase: SupabaseClient, workspaceId: string) {
  const limit = 50;
  const [
    documentsResult,
    invoicePayablesResult,
    creditPayablesResult,
    paymentsResult,
    paymentAllocationsResult,
    creditAllocationsResult,
    balancesResult,
    suppliersResult,
    settingsResult,
    summaryResult,
  ] = await Promise.all([
    supabase
      .from("supplier_documents")
      .select("id,supplier_id,document_type,document_number,document_date,due_date,currency,gross_amount,status,accounts_posting_status,approved_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "approved")
      .in("accounts_posting_status", ["ready", "posted", "reversed"])
      .order("approved_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    supabase
      .from("supplier_payable_balances")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("document_type", "invoice")
      .order("posted_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    supabase
      .from("supplier_payable_balances")
      .select("*")
      .eq("workspace_id", workspaceId)
      .eq("document_type", "credit_note")
      .order("posted_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    supabase
      .from("supplier_payment_balances")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("paid_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    supabase
      .from("supplier_payment_allocations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    supabase
      .from("supplier_credit_allocations")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("occurred_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1),
    supabase
      .from("supplier_account_balances")
      .select("*")
      .eq("workspace_id", workspaceId)
      .order("supplier_name")
      .range(0, limit),
    supabase
      .from("suppliers")
      .select("id,code,name,supplier_type,document_currency,status")
      .eq("workspace_id", workspaceId)
      .eq("status", "active")
      .order("name")
      .order("id")
      .limit(limit + 1),
    supabase
      .from("workspace_settings")
      .select("currency,timezone")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
    supabase.rpc("get_supplier_accounts_summary", { p_workspace_id: workspaceId }),
  ]);

  const failed = [
    documentsResult,
    invoicePayablesResult,
    creditPayablesResult,
    paymentsResult,
    paymentAllocationsResult,
    creditAllocationsResult,
    balancesResult,
    suppliersResult,
    settingsResult,
    summaryResult,
  ].find((result) => result.error);
  if (failed?.error) throw failed.error;

  const documents = documentsResult.data ?? [];
  const documentSupplierMap = await supplierMapForDocuments(supabase, workspaceId, documents);
  const documentPage = pageResult(documents, limit, (row) => row.approved_at);
  const invoicePage = pageResult(invoicePayablesResult.data ?? [], limit, (row) => row.posted_at);
  const creditPage = pageResult(creditPayablesResult.data ?? [], limit, (row) => row.posted_at);
  const paymentPage = pageResult(paymentsResult.data ?? [], limit, (row) => row.paid_at);
  const paymentAllocationPage = pageResult(paymentAllocationsResult.data ?? [], limit, (row) => row.occurred_at);
  const creditAllocationPage = pageResult(creditAllocationsResult.data ?? [], limit, (row) => row.occurred_at);
  const balances = balancesResult.data ?? [];
  const suppliers = suppliersResult.data ?? [];

  return {
    workspaceId,
    settings: settingsResult.data ?? { currency: "EUR", timezone: "UTC" },
    summary: summaryResult.data ?? {
      currency: settingsResult.data?.currency ?? "EUR",
      readyDocumentCount: 0,
      outstandingAmount: 0,
      unallocatedCreditAmount: 0,
      supplierAccountCount: 0,
    },
    documents: documentPage.rows.map((document) => ({
      ...document,
      supplier: document.supplier_id ? documentSupplierMap.get(document.supplier_id) ?? null : null,
    })),
    payables: [...invoicePage.rows, ...creditPage.rows],
    payments: paymentPage.rows,
    paymentAllocations: paymentAllocationPage.rows,
    creditAllocations: creditAllocationPage.rows,
    supplierBalances: balances.slice(0, limit),
    suppliers: suppliers.slice(0, limit),
    pageInfo: {
      documents: { pageSize: limit, hasMore: documentPage.hasMore, nextCursor: documentPage.nextCursor },
      invoicePayables: { pageSize: limit, hasMore: invoicePage.hasMore, nextCursor: invoicePage.nextCursor },
      creditPayables: { pageSize: limit, hasMore: creditPage.hasMore, nextCursor: creditPage.nextCursor },
      payments: { pageSize: limit, hasMore: paymentPage.hasMore, nextCursor: paymentPage.nextCursor },
      paymentAllocations: { pageSize: limit, hasMore: paymentAllocationPage.hasMore, nextCursor: paymentAllocationPage.nextCursor },
      creditAllocations: { pageSize: limit, hasMore: creditAllocationPage.hasMore, nextCursor: creditAllocationPage.nextCursor },
      balances: { pageSize: limit, hasMore: balances.length > limit, nextCursor: null },
      suppliers: { pageSize: limit, hasMore: suppliers.length > limit, nextCursor: null },
    },
  };
}

async function documentsPage(supabase: SupabaseClient, workspaceId: string, url: URL) {
  const limit = pageSize(url.searchParams.get("pageSize"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const q = searchTerm(url.searchParams.get("q"));
  let query = supabase
    .from("supplier_documents")
    .select("id,supplier_id,document_type,document_number,document_date,due_date,currency,gross_amount,status,accounts_posting_status,approved_at")
    .eq("workspace_id", workspaceId)
    .eq("status", "approved")
    .in("accounts_posting_status", ["ready", "posted", "reversed"])
    .order("approved_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (q) query = query.ilike("document_number", `%${q}%`);
  if (cursor) query = query.or(`approved_at.lt.${cursor.at},and(approved_at.eq.${cursor.at},id.lt.${cursor.id})`);
  const result = await query;
  if (result.error) throw result.error;
  const page = pageResult(result.data ?? [], limit, (row) => row.approved_at);
  const suppliers = await supplierMapForDocuments(supabase, workspaceId, page.rows);
  return {
    workspaceId,
    ...page,
    rows: page.rows.map((document) => ({
      ...document,
      supplier: document.supplier_id ? suppliers.get(document.supplier_id) ?? null : null,
    })),
  };
}

async function payablesPage(supabase: SupabaseClient, workspaceId: string, url: URL) {
  const limit = pageSize(url.searchParams.get("pageSize"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const q = searchTerm(url.searchParams.get("q"));
  const kind = String(url.searchParams.get("kind") ?? "invoice");
  if (!new Set(["invoice", "credit_note"]).has(kind)) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", "Supplier payable type is invalid.");
  }
  let query = supabase
    .from("supplier_payable_balances")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("document_type", kind)
    .order("posted_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`document_number_snapshot.ilike.${pattern},supplier_name_snapshot.ilike.${pattern},supplier_code_snapshot.ilike.${pattern}`);
  }
  if (cursor) query = query.or(`posted_at.lt.${cursor.at},and(posted_at.eq.${cursor.at},id.lt.${cursor.id})`);
  const result = await query;
  if (result.error) throw result.error;
  return { workspaceId, ...pageResult(result.data ?? [], limit, (row) => row.posted_at) };
}

async function paymentsPage(supabase: SupabaseClient, workspaceId: string, url: URL) {
  const limit = pageSize(url.searchParams.get("pageSize"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const q = searchTerm(url.searchParams.get("q"));
  let query = supabase
    .from("supplier_payment_balances")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("paid_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`reference.ilike.${pattern},supplier_name_snapshot.ilike.${pattern},supplier_code_snapshot.ilike.${pattern},external_reference.ilike.${pattern}`);
  }
  if (cursor) query = query.or(`paid_at.lt.${cursor.at},and(paid_at.eq.${cursor.at},id.lt.${cursor.id})`);
  const result = await query;
  if (result.error) throw result.error;
  return { workspaceId, ...pageResult(result.data ?? [], limit, (row) => row.paid_at) };
}

async function allocationsPage(
  supabase: SupabaseClient,
  workspaceId: string,
  url: URL,
  kind: "payment" | "credit",
) {
  const limit = pageSize(url.searchParams.get("pageSize"));
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const table = kind === "payment" ? "supplier_payment_allocations" : "supplier_credit_allocations";
  let query = supabase
    .from(table)
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (cursor) query = query.or(`occurred_at.lt.${cursor.at},and(occurred_at.eq.${cursor.at},id.lt.${cursor.id})`);
  const result = await query;
  if (result.error) throw result.error;
  return { workspaceId, ...pageResult(result.data ?? [], limit, (row) => row.occurred_at) };
}

async function balancesPage(supabase: SupabaseClient, workspaceId: string, url: URL) {
  const limit = pageSize(url.searchParams.get("pageSize"));
  const page = pageNumber(url.searchParams.get("page"));
  const q = searchTerm(url.searchParams.get("q"));
  const offset = page * limit;
  let query = supabase
    .from("supplier_account_balances")
    .select("*")
    .eq("workspace_id", workspaceId)
    .order("supplier_name")
    .order("supplier_id")
    .order("currency")
    .range(offset, offset + limit);
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`supplier_name.ilike.${pattern},supplier_code.ilike.${pattern}`);
  }
  const result = await query;
  if (result.error) throw result.error;
  const rows = result.data ?? [];
  return {
    workspaceId,
    rows: rows.slice(0, limit),
    page,
    pageSize: limit,
    hasMore: rows.length > limit,
    nextCursor: null,
  };
}

async function suppliersPage(supabase: SupabaseClient, workspaceId: string, url: URL) {
  const limit = pageSize(url.searchParams.get("pageSize"), 25, 50);
  const q = searchTerm(url.searchParams.get("q"));
  let query = supabase
    .from("suppliers")
    .select("id,code,name,supplier_type,document_currency,status")
    .eq("workspace_id", workspaceId)
    .eq("status", "active")
    .order("name")
    .order("id")
    .limit(limit + 1);
  if (q) {
    const pattern = `%${q}%`;
    query = query.or(`name.ilike.${pattern},code.ilike.${pattern}`);
  }
  const result = await query;
  if (result.error) throw result.error;
  const rows = result.data ?? [];
  return {
    workspaceId,
    rows: rows.slice(0, limit),
    pageSize: limit,
    hasMore: rows.length > limit,
    nextCursor: null,
  };
}

async function eligiblePage(supabase: SupabaseClient, workspaceId: string, url: URL) {
  const supplierId = uuid(url.searchParams.get("supplierId"), "Supplier");
  const currency = String(url.searchParams.get("currency") ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", "Supplier Payment currency is invalid.");
  }
  const q = searchTerm(url.searchParams.get("q"));
  let query = supabase
    .from("supplier_payable_balances")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("supplier_id", supplierId)
    .eq("currency", currency)
    .eq("document_type", "invoice")
    .eq("status", "posted")
    .gt("outstanding_amount", 0)
    .order("due_date")
    .order("posted_at")
    .limit(101);
  if (q) query = query.ilike("document_number_snapshot", `%${q}%`);
  const result = await query;
  if (result.error) throw result.error;
  const rows = result.data ?? [];
  return { workspaceId, rows: rows.slice(0, 100), pageSize: 100, hasMore: rows.length > 100, nextCursor: null };
}

export async function readSupplierPayablesView(
  supabase: SupabaseClient,
  workspaceId: string,
  url: URL,
) {
  const view = String(url.searchParams.get("view") ?? "bootstrap").trim();
  if (!REGISTER_VIEWS.has(view)) {
    throw new CommandError("INVALID_SUPPLIER_PAYABLES_INPUT", "Supplier Accounts view is invalid.");
  }
  if (view === "bootstrap") return bootstrap(supabase, workspaceId);
  if (view === "documents") return documentsPage(supabase, workspaceId, url);
  if (view === "payables") return payablesPage(supabase, workspaceId, url);
  if (view === "payments") return paymentsPage(supabase, workspaceId, url);
  if (view === "payment-allocations") return allocationsPage(supabase, workspaceId, url, "payment");
  if (view === "credit-allocations") return allocationsPage(supabase, workspaceId, url, "credit");
  if (view === "balances") return balancesPage(supabase, workspaceId, url);
  if (view === "suppliers") return suppliersPage(supabase, workspaceId, url);
  return eligiblePage(supabase, workspaceId, url);
}
