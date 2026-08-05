"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Building2,
  CircleCheckBig,
  FileSpreadsheet,
  Landmark,
  Link2,
  Plus,
  RefreshCw,
  RotateCcw,
  Scale,
  ShieldCheck,
  TriangleAlert,
  Upload,
  WifiOff,
} from "lucide-react";
import { Badge, Button, Card, Dialog, PageHeader, StatCard } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import {
  enqueueBankingCommand,
  flushBankingQueue,
  readBankingQueue,
  type BankingCommandAction,
  type BankingQueuedCommand,
} from "@/lib/modules/banking-queue";
import styles from "./banking.module.css";

type Tab = "transactions" | "accounts" | "imports" | "reconciliations";

type BankAccount = {
  id: string;
  code: string;
  display_name: string;
  institution_name: string;
  masked_identifier: string | null;
  currency: string;
  status: "active" | "archived";
  version: number;
};

type AccountSummary = {
  bank_account_id: string;
  code: string;
  display_name: string;
  institution_name: string;
  masked_identifier: string | null;
  currency: string;
  status: "active" | "archived";
  imported_credit_amount: number;
  imported_debit_amount: number;
  imported_net_movement: number;
  transaction_count: number;
  review_count: number;
};

type StatementImport = {
  id: string;
  bank_account_id: string;
  source_filename: string;
  source_file_hash: string;
  period_start: string | null;
  period_end: string | null;
  imported_count: number;
  duplicate_count: number;
  rejected_count: number;
  review_count: number;
  imported_at: string;
};

type BankTransaction = {
  id: string;
  bank_account_id: string | null;
  bank_account_code: string | null;
  bank_account_name: string | null;
  statement_import_id: string | null;
  transaction_date: string;
  value_date: string | null;
  description: string;
  external_reference: string | null;
  amount: number;
  transaction_type: "credit" | "debit";
  currency: string | null;
  record_status: "posted" | "reversed";
  reversal_reason: string | null;
  legacy_matched_invoice_id: string | null;
  reconciled_amount: number;
  unreconciled_amount: number;
  reconciliation_status: "unmatched" | "partially_matched" | "matched" | "reversed";
};

type ReconciliationAllocation = {
  id: string;
  bank_transaction_id: string;
  customer_payment_id: string | null;
  supplier_payment_id: string | null;
  allocation_type: "allocation" | "reversal";
  amount_delta: number;
  reversal_of_id: string | null;
  reason: string | null;
  occurred_at: string;
};

type CustomerPayment = {
  id: string;
  reference: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string;
  currency: string;
  amount: number;
  payment_method: string;
  external_reference: string | null;
  received_at: string;
  status: "posted" | "reversed";
  bank_reconciled_amount: number;
  bank_unreconciled_amount: number;
  bank_reconciliation_status: string;
};

type SupplierPayment = {
  id: string;
  reference: string;
  supplier_code_snapshot: string;
  supplier_name_snapshot: string;
  currency: string;
  amount: number;
  payment_method: string;
  external_reference: string | null;
  paid_at: string;
  status: "posted" | "reversed";
  bank_reconciled_amount: number;
  bank_unreconciled_amount: number;
  bank_reconciliation_status: string;
};

type Bundle = {
  workspaceId: string;
  settings: { currency: string; timezone: string };
  accounts: BankAccount[];
  accountSummaries: AccountSummary[];
  statementImports: StatementImport[];
  transactions: BankTransaction[];
  allocations: ReconciliationAllocation[];
  customerPayments: CustomerPayment[];
  supplierPayments: SupplierPayment[];
};

type Candidate = {
  id: string;
  reference: string;
  party: string;
  currency: string;
  amount: number;
  unreconciled: number;
  externalReference: string | null;
  date: string;
};

const emptyBundle: Bundle = {
  workspaceId: "",
  settings: { currency: "EUR", timezone: "UTC" },
  accounts: [],
  accountSummaries: [],
  statementImports: [],
  transactions: [],
  allocations: [],
  customerPayments: [],
  supplierPayments: [],
};

const CACHE_PREFIX = "bdb-banking-cache-v1";
const LAST_WORKSPACE_KEY = "bdb-banking-last-workspace-v1";
const cacheKey = (workspaceId: string) => `${CACHE_PREFIX}:${workspaceId}`;

function readCache(workspaceId: string): Bundle | null {
  if (typeof window === "undefined") return null;
  try {
    const value = JSON.parse(window.localStorage.getItem(cacheKey(workspaceId)) ?? "null") as Bundle | null;
    return value && Array.isArray(value.transactions) && Array.isArray(value.accounts) ? value : null;
  } catch {
    window.localStorage.removeItem(cacheKey(workspaceId));
    return null;
  }
}

function writeCache(bundle: Bundle) {
  if (typeof window === "undefined" || !bundle.workspaceId) return;
  window.localStorage.setItem(cacheKey(bundle.workspaceId), JSON.stringify(bundle));
  window.localStorage.setItem(LAST_WORKSPACE_KEY, bundle.workspaceId);
}

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

function transactionTone(status: BankTransaction["reconciliation_status"]): "neutral" | "gold" | "green" | "red" | "blue" {
  if (status === "matched") return "green";
  if (status === "partially_matched") return "gold";
  if (status === "unmatched") return "blue";
  if (status === "reversed") return "neutral";
  return "red";
}

export default function BankingPage() {
  const [bundle, setBundle] = useState<Bundle>(emptyBundle);
  const [loaded, setLoaded] = useState(false);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState<Tab>("transactions");
  const [queue, setQueue] = useState<BankingQueuedCommand[]>([]);
  const [accountOpen, setAccountOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [selectedTransaction, setSelectedTransaction] = useState<BankTransaction | null>(null);
  const [accountCode, setAccountCode] = useState("");
  const [accountName, setAccountName] = useState("");
  const [institutionName, setInstitutionName] = useState("");
  const [maskedIdentifier, setMaskedIdentifier] = useState("");
  const [accountCurrency, setAccountCurrency] = useState("EUR");
  const [importAccountId, setImportAccountId] = useState("");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [targetPaymentId, setTargetPaymentId] = useState("");
  const [reconciliationAmount, setReconciliationAmount] = useState("");

  const refreshQueue = useCallback((workspaceId: string) => {
    setQueue(readBankingQueue(workspaceId));
  }, []);

  const load = useCallback(async () => {
    const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
    const context = await contextResponse.json().catch(() => ({}));
    if (!contextResponse.ok || !context.currentWorkspaceId) {
      throw new Error(context.error ?? "The current workspace could not be resolved.");
    }
    const workspaceId = String(context.currentWorkspaceId);
    const response = await fetch(`/api/banking?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) throw new Error(result.error ?? "Banking could not be loaded.");
    const next = result.result as Bundle;
    setBundle(next);
    writeCache(next);
    refreshQueue(workspaceId);
    return next;
  }, [refreshQueue]);

  useEffect(() => {
    const update = () => setOnline(window.navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => {
    let active = true;
    async function initialise() {
      const lastWorkspace = window.localStorage.getItem(LAST_WORKSPACE_KEY) ?? "";
      const cached = lastWorkspace ? readCache(lastWorkspace) : null;
      if (cached && active) {
        setBundle(cached);
        refreshQueue(cached.workspaceId);
      }
      try {
        if (!window.navigator.onLine) {
          setNotice(cached ? "Showing the cached Banking workspace." : "Banking needs one online load before it can reopen offline.");
          return;
        }
        await load();
      } catch (initialError) {
        if (!cached) setError(initialError instanceof Error ? initialError.message : "Banking could not be loaded.");
      } finally {
        if (active) setLoaded(true);
      }
    }
    void initialise();
    return () => { active = false; };
  }, [load, refreshQueue]);

  useEffect(() => {
    if (!online || !bundle.workspaceId || busy || queue.length === 0) return;
    void syncQueue();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, bundle.workspaceId]);

  async function syncQueue() {
    if (!bundle.workspaceId || !online || busy) return;
    setBusy(true);
    setError("");
    try {
      const completed = await flushBankingQueue(bundle.workspaceId);
      await load();
      if (completed) setNotice(`${completed} Banking command${completed === 1 ? "" : "s"} synced.`);
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : "Banking synchronisation stopped on a conflict.");
      refreshQueue(bundle.workspaceId);
    } finally {
      setBusy(false);
    }
  }

  async function queuedCommand(action: BankingCommandAction, payload: Record<string, unknown>, queuedNotice: string) {
    if (!bundle.workspaceId || busy) return;
    enqueueBankingCommand(bundle.workspaceId, action, payload);
    refreshQueue(bundle.workspaceId);
    if (!online) {
      setNotice(queuedNotice);
      return;
    }
    await syncQueue();
  }

  async function directCommand(action: string, payload: Record<string, unknown>) {
    if (!bundle.workspaceId || busy || !online) return false;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/banking", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": crypto.randomUUID(),
        },
        body: JSON.stringify({ workspaceId: bundle.workspaceId, action, ...payload }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The Banking action could not be completed.");
      await load();
      return true;
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "The Banking action could not be completed.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createAccount(event: FormEvent) {
    event.preventDefault();
    const saved = await directCommand("account-create", {
      id: crypto.randomUUID(),
      code: accountCode,
      displayName: accountName,
      institutionName,
      maskedIdentifier,
      currency: accountCurrency,
    });
    if (saved) {
      setAccountOpen(false);
      setAccountCode("");
      setAccountName("");
      setInstitutionName("");
      setMaskedIdentifier("");
    }
  }

  async function archiveAccount(account: BankAccount) {
    if (!window.confirm(`Archive ${account.display_name}? Imported transactions and reconciliation history will remain visible.`)) return;
    await directCommand("account-archive", {
      accountId: account.id,
      expectedVersion: account.version,
    });
  }

  async function importStatement(event: FormEvent) {
    event.preventDefault();
    if (!bundle.workspaceId || !importFile || !importAccountId || busy || !online) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("workspaceId", bundle.workspaceId);
      form.set("bankAccountId", importAccountId);
      form.set("statementImportId", crypto.randomUUID());
      form.set("file", importFile);
      const response = await fetch("/api/banking/import", {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: form,
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The Bank statement could not be imported.");
      const imported = Number(result.result?.importedCount ?? result.result?.parsedCount ?? 0);
      const duplicates = Number(result.result?.duplicateCount ?? 0);
      setNotice(`Imported ${imported} transaction${imported === 1 ? "" : "s"}${duplicates ? `; ${duplicates} duplicate row${duplicates === 1 ? "" : "s"} skipped` : ""}.`);
      setImportOpen(false);
      setImportFile(null);
      await load();
    } catch (importError) {
      setError(importError instanceof Error ? importError.message : "The Bank statement could not be imported.");
    } finally {
      setBusy(false);
    }
  }

  const candidates = useMemo<Candidate[]>(() => {
    if (!selectedTransaction) return [];
    if (selectedTransaction.transaction_type === "credit") {
      return bundle.customerPayments
        .filter((payment) => payment.currency === selectedTransaction.currency && Number(payment.bank_unreconciled_amount) > 0)
        .map((payment) => ({
          id: payment.id,
          reference: payment.reference,
          party: `${payment.customer_name_snapshot} · ${payment.customer_code_snapshot}`,
          currency: payment.currency,
          amount: Number(payment.amount),
          unreconciled: Number(payment.bank_unreconciled_amount),
          externalReference: payment.external_reference,
          date: payment.received_at,
        }));
    }
    return bundle.supplierPayments
      .filter((payment) => payment.currency === selectedTransaction.currency && Number(payment.bank_unreconciled_amount) > 0)
      .map((payment) => ({
        id: payment.id,
        reference: payment.reference,
        party: `${payment.supplier_name_snapshot} · ${payment.supplier_code_snapshot}`,
        currency: payment.currency,
        amount: Number(payment.amount),
        unreconciled: Number(payment.bank_unreconciled_amount),
        externalReference: payment.external_reference,
        date: payment.paid_at,
      }));
  }, [bundle.customerPayments, bundle.supplierPayments, selectedTransaction]);

  function openReconcile(transaction: BankTransaction) {
    const pool = transaction.transaction_type === "credit" ? bundle.customerPayments : bundle.supplierPayments;
    const likely = pool.find((payment) =>
      payment.currency === transaction.currency
      && Number(payment.bank_unreconciled_amount) > 0
      && (
        (transaction.external_reference && payment.external_reference === transaction.external_reference)
        || Math.abs(Number(payment.bank_unreconciled_amount) - Number(transaction.unreconciled_amount)) < 0.0001
      ),
    );
    setSelectedTransaction(transaction);
    setTargetPaymentId(likely?.id ?? "");
    setReconciliationAmount(likely
      ? String(Math.min(Number(transaction.unreconciled_amount), Number(likely.bank_unreconciled_amount)))
      : String(Number(transaction.unreconciled_amount)));
  }

  function choosePayment(paymentId: string) {
    setTargetPaymentId(paymentId);
    const candidate = candidates.find((item) => item.id === paymentId);
    if (candidate && selectedTransaction) {
      setReconciliationAmount(String(Math.min(Number(selectedTransaction.unreconciled_amount), candidate.unreconciled)));
    }
  }

  async function reconcile(event: FormEvent) {
    event.preventDefault();
    if (!selectedTransaction || !targetPaymentId) return;
    await queuedCommand("reconcile", {
      id: crypto.randomUUID(),
      bankTransactionId: selectedTransaction.id,
      targetType: selectedTransaction.transaction_type === "credit" ? "customer_payment" : "supplier_payment",
      targetPaymentId,
      amount: Number(reconciliationAmount),
      occurredAt: new Date().toISOString(),
    }, "Bank reconciliation queued. It will be revalidated when connectivity returns.");
    setSelectedTransaction(null);
    setTargetPaymentId("");
    setReconciliationAmount("");
  }

  async function reverseAllocation(allocation: ReconciliationAllocation) {
    const reason = window.prompt("Reason for reversing this Bank reconciliation:", "Reconciliation corrected");
    if (!reason) return;
    await queuedCommand("reconciliation-reverse", {
      id: crypto.randomUUID(),
      allocationId: allocation.id,
      reason,
      occurredAt: new Date().toISOString(),
    }, "Bank reconciliation reversal queued.");
  }

  async function reverseTransaction(transaction: BankTransaction) {
    const reason = window.prompt("Reason for reversing this imported Bank transaction:", "Source transaction corrected");
    if (!reason) return;
    await queuedCommand("transaction-reverse", {
      bankTransactionId: transaction.id,
      reason,
    }, "Bank transaction reversal queued.");
  }

  const activeAccounts = bundle.accounts.filter((account) => account.status === "active");
  const postedTransactions = bundle.transactions.filter((transaction) => transaction.record_status === "posted");
  const creditAmount = postedTransactions
    .filter((transaction) => transaction.transaction_type === "credit")
    .reduce((total, transaction) => total + Number(transaction.amount), 0);
  const debitAmount = postedTransactions
    .filter((transaction) => transaction.transaction_type === "debit")
    .reduce((total, transaction) => total + Number(transaction.amount), 0);
  const reviewCount = postedTransactions.filter((transaction) => transaction.reconciliation_status !== "matched").length;
  const matchedCount = postedTransactions.filter((transaction) => transaction.reconciliation_status === "matched").length;
  const reversedAllocationIds = new Set(bundle.allocations.filter((item) => item.reversal_of_id).map((item) => item.reversal_of_id));
  const activeAllocations = bundle.allocations.filter((allocation) =>
    allocation.allocation_type === "allocation" && !reversedAllocationIds.has(allocation.id),
  );

  if (!loaded && !bundle.workspaceId) {
    return <Card className={styles.loadingCard}><RefreshCw className={styles.spin} size={20} /> Loading Banking…</Card>;
  }

  return (
    <>
      <PageHeader
        eyebrow="Cash verification"
        title="Banking"
        description="Import Bank statements and reconcile cash evidence against immutable Customer and Supplier Payments."
        action={(
          <div className={styles.headerActions}>
            <Button variant="quiet" disabled={busy || !online} onClick={() => setAccountOpen(true)}>
              <Plus size={16} /> Add account
            </Button>
            <Button
              disabled={busy || !online || activeAccounts.length === 0}
              onClick={() => {
                setImportAccountId(activeAccounts[0]?.id ?? "");
                setImportOpen(true);
              }}
            >
              <Upload size={16} /> Import CSV
            </Button>
          </div>
        )}
      />

      {!online ? (
        <div className={styles.callout}><WifiOff size={19} /><div><strong>Offline Banking workspace</strong><p>Cached records remain available. Reconciliation commands are queued; statement import and Bank account setup require connectivity.</p></div></div>
      ) : null}
      {queue.length > 0 ? (
        <div className={styles.callout}><RefreshCw size={19} /><div><strong>{queue.length} command{queue.length === 1 ? "" : "s"} waiting</strong><p>Commands replay in order and stop on the first conflict.</p></div><Button variant="quiet" disabled={busy || !online} onClick={() => void syncQueue()}>Sync</Button></div>
      ) : null}
      {error ? <div className={styles.error}><TriangleAlert size={18} />{error}</div> : null}
      {notice ? <div className={styles.notice}><CircleCheckBig size={18} />{notice}</div> : null}

      <div className="stat-grid">
        <StatCard label="Imported net movement" value={formatMoney(creditAmount - debitAmount, bundle.settings.currency)} detail="Statement evidence, not a live balance" icon={<Landmark size={19} />} />
        <StatCard label="Money in" value={formatMoney(creditAmount, bundle.settings.currency)} detail="Imported credit transactions" icon={<ArrowDownLeft size={19} />} />
        <StatCard label="Money out" value={formatMoney(debitAmount, bundle.settings.currency)} detail="Imported debit transactions" icon={<ArrowUpRight size={19} />} />
        <StatCard label="To review" value={String(reviewCount)} detail={`${matchedCount} fully reconciled`} icon={<Scale size={19} />} />
      </div>

      <div className={styles.boundary}>
        <ShieldCheck size={20} />
        <div>
          <strong>Banking verifies Payments; it does not settle Invoices directly.</strong>
          <p>Invoice and Supplier payable balances continue to derive from Accounts allocations. Bank reconciliation creates evidence only.</p>
        </div>
      </div>

      <div className={styles.tabs} role="tablist" aria-label="Banking views">
        {([
          ["transactions", "Transactions"],
          ["accounts", "Bank accounts"],
          ["imports", "Statement imports"],
          ["reconciliations", "Reconciliations"],
        ] as const).map(([value, label]) => (
          <button key={value} type="button" className={tab === value ? styles.activeTab : ""} onClick={() => setTab(value)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "transactions" ? (
        <Card className="table-card">
          <div className={styles.sectionHead}>
            <div><p className="eyebrow">Imported evidence</p><h2>Bank transactions</h2></div>
            <span className="muted small">{postedTransactions.length} active record{postedTransactions.length === 1 ? "" : "s"}</span>
          </div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Description</th><th>Account</th><th>Status</th><th className="align-right">Amount</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {bundle.transactions.map((transaction) => {
                  const legacy = !transaction.bank_account_id || !transaction.currency;
                  return (
                    <tr key={transaction.id}>
                      <td>{formatDate(transaction.transaction_date, { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td><strong>{transaction.description}</strong><span className={styles.subline}>{transaction.external_reference ?? "No Bank reference"}</span></td>
                      <td>{transaction.bank_account_name ?? "Legacy transaction"}<span className={styles.subline}>{transaction.bank_account_code ?? "Review required"}</span></td>
                      <td><Badge tone={legacy ? "red" : transactionTone(transaction.reconciliation_status)}>{legacy ? "legacy review" : statusLabel(transaction.reconciliation_status)}</Badge></td>
                      <td className="align-right"><strong className={transaction.transaction_type === "credit" ? styles.credit : undefined}>{transaction.transaction_type === "credit" ? "+" : "−"}{formatMoney(Number(transaction.amount), transaction.currency ?? bundle.settings.currency)}</strong><span className={styles.subline}>{formatMoney(Number(transaction.unreconciled_amount), transaction.currency ?? bundle.settings.currency)} unmatched</span></td>
                      <td>
                        <div className="table-actions">
                          {transaction.record_status === "posted" && !legacy && Number(transaction.unreconciled_amount) > 0 ? (
                            <button className="link-button" onClick={() => openReconcile(transaction)}>Reconcile</button>
                          ) : null}
                          {transaction.record_status === "posted" && Number(transaction.reconciled_amount) === 0 ? (
                            <button className="link-button" onClick={() => void reverseTransaction(transaction)}>Reverse</button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {bundle.transactions.length === 0 ? <div className="card-pad"><h2>No Bank transactions</h2><p className="muted">Add a Bank account, then import a CSV statement.</p></div> : null}
        </Card>
      ) : null}

      {tab === "accounts" ? (
        <div className={styles.accountGrid}>
          {bundle.accounts.map((account) => {
            const summary = bundle.accountSummaries.find((item) => item.bank_account_id === account.id);
            return (
              <Card key={account.id} className={styles.accountCard}>
                <div className={styles.accountHead}><span><Building2 size={18} /></span><Badge tone={account.status === "active" ? "green" : "neutral"}>{account.status}</Badge></div>
                <p className="eyebrow">{account.institution_name}</p>
                <h2>{account.display_name}</h2>
                <p className="muted">{account.code} · {account.masked_identifier ?? "Identifier not recorded"} · {account.currency}</p>
                <div className={styles.accountStats}>
                  <div><span>Imported movement</span><strong>{formatMoney(Number(summary?.imported_net_movement ?? 0), account.currency)}</strong></div>
                  <div><span>Transactions</span><strong>{summary?.transaction_count ?? 0}</strong></div>
                  <div><span>To review</span><strong>{summary?.review_count ?? 0}</strong></div>
                </div>
                {account.status === "active" ? <Button variant="quiet" disabled={busy || !online} onClick={() => void archiveAccount(account)}>Archive account</Button> : null}
              </Card>
            );
          })}
          {bundle.accounts.length === 0 ? <Card className="card-pad"><h2>No Bank accounts</h2><p className="muted">Create a manual Bank account record before importing statements.</p></Card> : null}
        </div>
      ) : null}

      {tab === "imports" ? (
        <Card className="table-card">
          <div className={styles.sectionHead}><div><p className="eyebrow">Immutable batches</p><h2>Statement imports</h2></div><FileSpreadsheet size={20} /></div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Imported</th><th>File</th><th>Period</th><th>Account</th><th className="align-right">Rows</th><th className="align-right">Duplicates</th></tr></thead>
              <tbody>
                {bundle.statementImports.map((item) => {
                  const account = bundle.accounts.find((candidate) => candidate.id === item.bank_account_id);
                  return (
                    <tr key={item.id}>
                      <td>{formatDate(item.imported_at, { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td><strong>{item.source_filename}</strong><span className={styles.subline}>{item.source_file_hash.slice(0, 12)}…</span></td>
                      <td>{item.period_start && item.period_end ? `${item.period_start} → ${item.period_end}` : "No imported rows"}</td>
                      <td>{account?.display_name ?? "Unknown account"}</td>
                      <td className="align-right">{item.imported_count}</td>
                      <td className="align-right">{item.duplicate_count}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {bundle.statementImports.length === 0 ? <div className="card-pad"><h2>No statement imports</h2><p className="muted">Imported files are recorded here with their content hash and row counts.</p></div> : null}
        </Card>
      ) : null}

      {tab === "reconciliations" ? (
        <Card className="table-card">
          <div className={styles.sectionHead}><div><p className="eyebrow">Append-only evidence</p><h2>Active reconciliation allocations</h2></div><Link2 size={20} /></div>
          <div className="table-scroll">
            <table>
              <thead><tr><th>Date</th><th>Bank transaction</th><th>Payment target</th><th className="align-right">Amount</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {activeAllocations.map((allocation) => {
                  const transaction = bundle.transactions.find((item) => item.id === allocation.bank_transaction_id);
                  const customerPayment = allocation.customer_payment_id ? bundle.customerPayments.find((item) => item.id === allocation.customer_payment_id) : null;
                  const supplierPayment = allocation.supplier_payment_id ? bundle.supplierPayments.find((item) => item.id === allocation.supplier_payment_id) : null;
                  return (
                    <tr key={allocation.id}>
                      <td>{formatDate(allocation.occurred_at, { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td><strong>{transaction?.description ?? "Bank transaction"}</strong><span className={styles.subline}>{transaction?.external_reference ?? allocation.bank_transaction_id.slice(0, 8)}</span></td>
                      <td>{customerPayment ? `${customerPayment.reference} · ${customerPayment.customer_name_snapshot}` : supplierPayment ? `${supplierPayment.reference} · ${supplierPayment.supplier_name_snapshot}` : "Historical Payment"}</td>
                      <td className="align-right"><strong>{formatMoney(Number(allocation.amount_delta), transaction?.currency ?? bundle.settings.currency)}</strong></td>
                      <td><button className="link-button" onClick={() => void reverseAllocation(allocation)}><RotateCcw size={15} /> Reverse</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {activeAllocations.length === 0 ? <div className="card-pad"><h2>No active reconciliations</h2><p className="muted">Match imported credits to Customer Payments and imported debits to Supplier Payments.</p></div> : null}
        </Card>
      ) : null}

      <Dialog open={accountOpen} onClose={() => { if (!busy) setAccountOpen(false); }} title="Add Bank account" description="This creates a manual account identity only. No Bank credentials or live connection are stored.">
        <form onSubmit={(event) => void createAccount(event)} className={styles.form}>
          <div className={styles.formGrid}>
            <div className="field"><label htmlFor="bank-code">Code</label><input id="bank-code" required minLength={2} maxLength={32} value={accountCode} onChange={(event) => setAccountCode(event.target.value.toUpperCase())} placeholder="BOV-EUR" /></div>
            <div className="field"><label htmlFor="bank-currency">Currency</label><input id="bank-currency" required pattern="[A-Za-z]{3}" maxLength={3} value={accountCurrency} onChange={(event) => setAccountCurrency(event.target.value.toUpperCase())} /></div>
          </div>
          <div className="field"><label htmlFor="bank-name">Display name</label><input id="bank-name" required minLength={2} maxLength={120} value={accountName} onChange={(event) => setAccountName(event.target.value)} placeholder="Operating account" /></div>
          <div className="field"><label htmlFor="institution-name">Institution</label><input id="institution-name" required minLength={2} maxLength={160} value={institutionName} onChange={(event) => setInstitutionName(event.target.value)} placeholder="Bank of Valletta" /></div>
          <div className="field"><label htmlFor="masked-id">Masked identifier</label><input id="masked-id" maxLength={80} value={maskedIdentifier} onChange={(event) => setMaskedIdentifier(event.target.value)} placeholder="•••• 1234" /></div>
          <div className="dialog-actions"><Button variant="quiet" type="button" disabled={busy} onClick={() => setAccountOpen(false)}>Cancel</Button><Button disabled={busy || !online}>{busy ? "Saving…" : "Create account"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={importOpen} onClose={() => { if (!busy) setImportOpen(false); }} title="Import Bank statement" description="CSV import is online-only. The original file hash and immutable transaction rows are retained for duplicate protection.">
        <form onSubmit={(event) => void importStatement(event)} className={styles.form}>
          <div className="field"><label htmlFor="import-account">Bank account</label><select id="import-account" required value={importAccountId} onChange={(event) => setImportAccountId(event.target.value)}><option value="">Select account</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.display_name} · {account.currency}</option>)}</select></div>
          <div className="field"><label htmlFor="statement-file">CSV file</label><input id="statement-file" type="file" accept=".csv,.txt,text/csv,text/plain" required onChange={(event) => setImportFile(event.target.files?.[0] ?? null)} /></div>
          <Card className={styles.templateCard}><FileSpreadsheet size={18} /><div><strong>Supported headers</strong><p>Date, Description and Amount are required. Type, Reference, Value Date and Currency are optional. Separate Credit and Debit columns are also supported.</p></div></Card>
          <div className="dialog-actions"><Button variant="quiet" type="button" disabled={busy} onClick={() => setImportOpen(false)}>Cancel</Button><Button disabled={busy || !online || !importFile}>{busy ? "Importing…" : "Import statement"}</Button></div>
        </form>
      </Dialog>

      <Dialog open={Boolean(selectedTransaction)} onClose={() => { if (!busy) setSelectedTransaction(null); }} title="Reconcile Bank transaction" description="Confirm the Payment that this Bank transaction proves. Invoice and payable allocations are not changed.">
        {selectedTransaction ? (
          <form onSubmit={(event) => void reconcile(event)} className={styles.form}>
            <Card className={styles.transactionCard}>
              <span className={selectedTransaction.transaction_type === "credit" ? styles.creditIcon : styles.debitIcon}>{selectedTransaction.transaction_type === "credit" ? <ArrowDownLeft size={18} /> : <ArrowUpRight size={18} />}</span>
              <div><p className="eyebrow">{selectedTransaction.transaction_type === "credit" ? "Money received" : "Money sent"}</p><h2>{selectedTransaction.description}</h2><p className="muted">{selectedTransaction.external_reference ?? "No Bank reference"}</p></div>
              <strong>{formatMoney(Number(selectedTransaction.unreconciled_amount), selectedTransaction.currency ?? bundle.settings.currency)} unmatched</strong>
            </Card>
            <div className="field"><label htmlFor="payment-target">{selectedTransaction.transaction_type === "credit" ? "Customer Payment" : "Supplier Payment"}</label><select id="payment-target" required value={targetPaymentId} onChange={(event) => choosePayment(event.target.value)}><option value="">Choose a Payment</option>{candidates.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.reference} · {candidate.party} · {formatMoney(candidate.unreconciled, candidate.currency)} available</option>)}</select></div>
            <div className="field"><label htmlFor="reconciliation-amount">Amount to reconcile</label><input id="reconciliation-amount" type="number" min="0.0001" step="0.0001" required value={reconciliationAmount} onChange={(event) => setReconciliationAmount(event.target.value)} /></div>
            {candidates.length === 0 ? <div className={styles.error}><TriangleAlert size={18} />No unreconciled {selectedTransaction.transaction_type === "credit" ? "Customer" : "Supplier"} Payment uses this currency. Record the Payment in Accounts first.</div> : null}
            <div className="dialog-actions"><Button variant="quiet" type="button" disabled={busy} onClick={() => setSelectedTransaction(null)}>Cancel</Button><Button disabled={busy || !targetPaymentId || Number(reconciliationAmount) <= 0}>{online ? "Confirm reconciliation" : "Queue reconciliation"}</Button></div>
          </form>
        ) : null}
      </Dialog>
    </>
  );
}
