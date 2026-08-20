"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { formatMoney } from "@/lib/format";
import { AccountsComposerFrame } from "./accounts-composer-frame";
import { useAccountsCommandRuntime } from "./accounts-command-runtime";
import styles from "./accounts-composer.module.css";

type InvoiceLine = {
  id: string;
  line_number: number;
  code_snapshot: string;
  description_snapshot: string;
  quantity: number;
  total_amount: number;
};

type CreditInvoice = {
  id: string;
  number: string;
  customer_id: string;
  customer_name_snapshot: string;
  currency: string;
  total_amount: number;
  credited_amount: number;
  adjusted_total_amount: number;
  outstanding_amount: number;
  display_status: string;
  sales_order_reference: string | null;
  invoice_lines: InvoiceLine[];
};

type IssuedCredit = {
  id: string;
  status: string;
  credit_note_lines: Array<{ source_invoice_line_id: string | null; quantity: number }>;
};

type DraftLine = {
  id: string;
  sourceLineId: string;
  code: string;
  description: string;
  remainingQuantity: number;
  selected: boolean;
  quantity: string;
};

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function CreditNoteComposer() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const runtime = useAccountsCommandRuntime();
  const workspaceId = runtime.workspaceId;
  const setRuntimeError = runtime.setError;
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoice, setInvoice] = useState<CreditInvoice | null>(null);
  const [lines, setLines] = useState<DraftLine[]>([]);
  const [mode, setMode] = useState<"full" | "quantity">("full");
  const [reason, setReason] = useState("");
  const [resolving, setResolving] = useState(false);
  const initialInvoiceId = searchParams.get("invoiceId") ?? "";

  const resolveInvoice = useCallback(async (options: { id?: string; number?: string }) => {
    if (!workspaceId) return;
    setResolving(true);
    setRuntimeError("");
    try {
      const params = new URLSearchParams({ workspaceId, resource: "credit-invoice" });
      if (options.id) params.set("id", options.id);
      else params.set("number", String(options.number ?? "").trim());
      const response = await fetch(`/api/accounts/composer?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "The Invoice could not be opened for credit.");
      const target = result.result?.invoice as CreditInvoice;
      const issuedCredits = (result.result?.issuedCredits ?? []) as IssuedCredit[];
      const creditedByLine = new Map<string, number>();
      for (const credit of issuedCredits) {
        for (const line of credit.credit_note_lines ?? []) {
          if (!line.source_invoice_line_id) continue;
          creditedByLine.set(line.source_invoice_line_id, (creditedByLine.get(line.source_invoice_line_id) ?? 0) + Number(line.quantity));
        }
      }
      const available = target.invoice_lines.map((line) => {
        const remainingQuantity = Math.max(Number(line.quantity) - (creditedByLine.get(line.id) ?? 0), 0);
        return {
          id: crypto.randomUUID(),
          sourceLineId: line.id,
          code: line.code_snapshot,
          description: line.description_snapshot,
          remainingQuantity,
          selected: remainingQuantity > 0,
          quantity: String(remainingQuantity),
        };
      }).filter((line) => line.remainingQuantity > 0);
      setInvoice(target);
      setInvoiceNumber(target.number);
      setLines(available);
      setMode("full");
    } catch (lookupError) {
      setInvoice(null);
      setLines([]);
      setRuntimeError(lookupError instanceof Error ? lookupError.message : "The Invoice could not be opened for credit.");
    } finally {
      setResolving(false);
    }
  }, [setRuntimeError, workspaceId]);

  useEffect(() => {
    if (!initialInvoiceId || !workspaceId || invoice) return;
    const timer = window.setTimeout(() => void resolveInvoice({ id: initialInvoiceId }), 0);
    return () => window.clearTimeout(timer);
  }, [initialInvoiceId, invoice, resolveInvoice, workspaceId]);

  const preview = useMemo(() => {
    if (!invoice) return 0;
    return round4(lines.filter((line) => mode === "full" || line.selected).reduce((sum, line) => {
      const source = invoice.invoice_lines.find((item) => item.id === line.sourceLineId);
      const quantity = mode === "full" ? line.remainingQuantity : Number(line.quantity || 0);
      if (!source || quantity <= 0) return sum;
      return sum + Number(source.total_amount) * quantity / Math.max(Number(source.quantity), 0.000001);
    }, 0));
  }, [invoice, lines, mode]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!invoice || invoice.number.toLowerCase() !== invoiceNumber.trim().toLowerCase()) {
      return runtime.setError("Resolve the exact issued Invoice before creating this Credit Note.");
    }
    const chosen = lines.filter((line) => mode === "full" || line.selected).map((line) => ({
      id: line.id,
      sourceInvoiceLineId: line.sourceLineId,
      quantity: mode === "full" ? line.remainingQuantity : Number(line.quantity),
    })).filter((line) => Number.isFinite(line.quantity) && line.quantity > 0);
    if (!chosen.length) return runtime.setError("Choose at least one genuine Product or Service quantity to credit.");
    const invalid = chosen.find((line) => line.quantity > (lines.find((item) => item.sourceLineId === line.sourceInvoiceLineId)?.remainingQuantity ?? 0));
    if (invalid) return runtime.setError("A Credit Note quantity cannot exceed the original Invoice quantity remaining.");

    const result = await runtime.dispatch("credit-note-create", {
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      reason: reason.trim(),
      lines: chosen,
    });
    if (result.ok) router.push(result.pending ? "/accounts" : `/accounts/sales/invoices/${invoice.id}`);
  }

  return (
    <AccountsComposerFrame
      eyebrow="Accounts · Sales · Credit Note"
      title="New Credit Note"
      description="Credit Notes originate from an issued Invoice. Values come from its immutable line snapshots—never from an arbitrary money amount."
      backHref="/accounts/sales/new"
      backLabel="Document types"
      online={runtime.online}
      pendingCount={runtime.pendingCount}
      loading={runtime.loading}
      error={runtime.error}
      notice={runtime.notice}
      onDismissError={() => runtime.setError("")}
      onDismissNotice={() => runtime.setNotice("")}
    >
      <form className={styles.formPanel} onSubmit={submit}>
        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><div><h2>Original Invoice</h2><p>Type the exact Invoice number. No standalone Credit Note can be created.</p></div></div>
          <div className={styles.sourceToolbar}>
            <label className={styles.searchField}><span>Invoice number</span><span className={styles.searchInput}><Search size={15} /><input required value={invoiceNumber} onChange={(event) => { setInvoiceNumber(event.target.value.toUpperCase()); setInvoice(null); setLines([]); }} placeholder="INV001" autoComplete="off" /></span></label>
            <button className={styles.secondaryLink} type="button" disabled={!invoiceNumber.trim() || resolving || !workspaceId} onClick={() => void resolveInvoice({ number: invoiceNumber })}>{resolving ? "Resolving…" : "Open exact Invoice"}</button>
          </div>
          {invoice ? <div className={styles.selectedRecord}><span><strong>{invoice.number} · {invoice.customer_name_snapshot}</strong><small>Original {formatMoney(Number(invoice.total_amount), invoice.currency)} · Current balance {formatMoney(Number(invoice.outstanding_amount), invoice.currency)}{invoice.sales_order_reference ? ` · SO ${invoice.sales_order_reference}` : ""}</small></span></div> : null}
        </section>

        {invoice ? <section className={styles.formSection}>
          <div className={styles.sectionHeading}><div><h2>Controlled reversal</h2><p>Wrong price means full Credit Note plus a new Invoice. Partial credit is only for genuine quantity or service reduction.</p></div></div>
          <div className={styles.formGrid}><label className={styles.field}><span>Credit type</span><select value={mode} onChange={(event) => setMode(event.target.value as typeof mode)}><option value="full">Full Invoice cancellation</option><option value="quantity">Product / Service quantity reduction</option></select></label><label className={styles.field}><span>Sales Order reference</span><input readOnly value={invoice.sales_order_reference ?? "Not required"} /></label></div>
          <div className={styles.selectionList}>{lines.map((line, index) => <label className={styles.selectionRow} key={line.id}><input type="checkbox" checked={mode === "full" || line.selected} disabled={mode === "full"} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} /><span><strong>{line.code} · {line.description}</strong><small>{line.remainingQuantity.toLocaleString()} remaining from original Invoice</small></span><input type="number" min="0.001" step="0.001" max={line.remainingQuantity} readOnly={mode === "full"} disabled={mode === "quantity" && !line.selected} value={mode === "full" ? String(line.remainingQuantity) : line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label>)}</div>
          <div className={styles.summary}><div><span>Original Invoice</span><strong>{formatMoney(Number(invoice.total_amount), invoice.currency)}</strong></div><div><span>Already credited</span><strong>{formatMoney(Number(invoice.credited_amount), invoice.currency)}</strong></div><div><span>Estimated Credit Note</span><strong>{formatMoney(preview, invoice.currency)}</strong></div></div>
        </section> : null}

        <section className={styles.formSection}><div className={styles.sectionHeading}><div><h2>Reason</h2><p>The reason becomes part of the issued Credit Note.</p></div></div><label className={`${styles.field} ${styles.wide}`}><span>Credit Note reason</span><textarea required minLength={5} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this Invoice or quantity being credited?" /></label></section>
        <footer className={styles.actions}><span className={styles.hint}>The original Invoice total and historical PDF remain unchanged.</span><div><button type="button" onClick={() => router.push("/accounts/sales/credit-notes")}>Cancel</button><button type="submit" disabled={!invoice || Boolean(runtime.busy) || runtime.supportReadOnly}>Create Credit Note</button></div></footer>
      </form>
    </AccountsComposerFrame>
  );
}
