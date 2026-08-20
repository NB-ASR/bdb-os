"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, Banknote, ExternalLink, FileMinus2, FileText, Mail, MessageSquarePlus, MessageSquareText, PackageCheck, Printer } from "lucide-react";
import { useAccountsCommandRuntime } from "@/components/accounts/accounts-command-runtime";
import { formatDate, formatMoney } from "@/lib/format";
import styles from "../../../accounts-workspace.module.css";

type InvoiceLine = {
  id: string;
  line_number: number;
  code_snapshot: string;
  description_snapshot: string;
  quantity: number;
  unit_price: number;
  discount_amount: number;
  net_amount: number;
  vat_rate: number;
  vat_amount: number;
  total_amount: number;
};

type Invoice = {
  id: string;
  number: string;
  customer_id: string;
  customer_code_snapshot: string;
  customer_name_snapshot: string;
  customer_address_snapshot: string | null;
  customer_vat_number_snapshot: string | null;
  issued_at: string;
  due_at: string | null;
  description: string;
  notes: string | null;
  currency: string;
  display_status: string;
  payment_status: string;
  gross_amount: number;
  discount_amount: number;
  net_amount: number;
  vat_amount: number;
  total_amount: number;
  credited_amount: number;
  allocated_amount: number;
  outstanding_amount: number;
  sales_order_reference: string | null;
  invoice_lines: InvoiceLine[];
};

type Customer = { id: string; code: string; name: string; company: string | null; email: string | null; phone: string | null; address: string | null; vat_number: string | null };
type CreditNote = { id: string; number: string; reason: string; status: string; issued_at: string | null; created_at: string; currency: string; total_amount: number };
type Payment = { id: string; reference: string; currency: string; amount: number; allocated_to_invoice: number; payment_method: string; external_reference: string | null; received_at: string; status: string };
type DeliveryNote = { id: string; number: string; delivery_date: string; status: string; delivery_address: string | null; created_at: string };
type Note = { id: string; note: string; created_by: string; created_at: string };
type DetailBundle = { workspaceId: string; invoice: Invoice; customer: Customer | null; creditNotes: CreditNote[]; payments: Payment[]; deliveryNotes: DeliveryNote[]; notes: Note[] };

function documentUrl(workspaceId: string, invoiceId: string, format: "html" | "pdf", print = false) {
  const params = new URLSearchParams({ workspaceId, type: "invoice", id: invoiceId, format });
  if (print) params.set("print", "1");
  return `/api/business-documents/render?${params.toString()}`;
}

function statusTone(status: string) {
  if (status === "paid" || status === "cancelled") return "good";
  if (status === "overdue" || status === "partially_paid") return "attention";
  return "neutral";
}

export default function InvoiceDetailPage() {
  const params = useParams<{ id: string }>();
  const invoiceId = String(params.id ?? "");
  const [bundle, setBundle] = useState<DetailBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [newNote, setNewNote] = useState("");
  const noteRuntime = useAccountsCommandRuntime();

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
      const workspaceId = String(context.currentWorkspaceId);
      const response = await fetch(`/api/accounts/invoices/${encodeURIComponent(invoiceId)}?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Invoice could not be loaded.");
      setBundle(result.result as DetailBundle);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Invoice could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, [invoiceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const invoice = bundle?.invoice;
  const emailHref = useMemo(() => {
    if (!invoice || !bundle?.customer?.email) return null;
    const subject = encodeURIComponent(`Invoice ${invoice.number}`);
    const body = encodeURIComponent(`Please find Invoice ${invoice.number} from BDB OS.\n\nDownload the PDF from BDB OS and attach it before sending.`);
    return `mailto:${bundle.customer.email}?subject=${subject}&body=${body}`;
  }, [bundle?.customer?.email, invoice]);

  async function addNote(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!invoice || !newNote.trim()) return;
    const result = await noteRuntime.dispatch("document-note-add", {
      id: crypto.randomUUID(),
      documentType: "invoice",
      documentId: invoice.id,
      note: newNote.trim(),
    });
    if (!result.ok) return;
    setNewNote("");
    if (!result.pending) await load();
  }

  if (loading && !invoice) return <main className={styles.workspace}><div className={styles.emptyState}>Loading Invoice…</div></main>;
  if (!invoice || !bundle) return <main className={styles.workspace}><div className={styles.notice}><AlertTriangle size={17} /><div><strong>Invoice could not be opened</strong><br />{error || "The requested Invoice is unavailable."}</div></div><Link className={styles.secondaryLink} href="/accounts/sales/invoices"><ArrowLeft size={15} /> Back to Invoices</Link></main>;

  return (
    <main className={styles.workspace}>
      <section className={styles.detailHeader}>
        <div className={styles.detailTitle}>
          <p className={styles.eyebrow}>Accounts · Sales · Invoice</p>
          <h1>{invoice.number}</h1>
          <div className={styles.detailMeta}>{invoice.customer_name_snapshot} · {formatDate(invoice.issued_at)} · <span className={styles.status} data-tone={statusTone(invoice.display_status)}>{invoice.display_status.replaceAll("_", " ")}</span></div>
        </div>
        <div className={styles.detailActions}>
          <Link className={styles.secondaryLink} href="/accounts/sales/invoices"><ArrowLeft size={15} /> Register</Link>
          <a className={styles.secondaryLink} href={documentUrl(bundle.workspaceId, invoice.id, "html")} target="_blank" rel="noreferrer"><ExternalLink size={15} /> View</a>
          <a className={styles.secondaryLink} href={documentUrl(bundle.workspaceId, invoice.id, "html", true)} target="_blank" rel="noreferrer"><Printer size={15} /> Print</a>
          <a className={styles.secondaryLink} href={documentUrl(bundle.workspaceId, invoice.id, "pdf")}><FileText size={15} /> PDF</a>
          {emailHref ? <a className={styles.secondaryLink} href={emailHref}><Mail size={15} /> Email</a> : null}
          {Number(invoice.credited_amount) < Number(invoice.total_amount) ? <Link className={styles.secondaryLink} href={`/accounts/sales/credit-notes/new?invoiceId=${invoice.id}`}><FileMinus2 size={15} /> Credit Note</Link> : null}
        </div>
      </section>

      {error ? <div className={styles.notice}><AlertTriangle size={17} /><div><strong>Refresh warning</strong><br />{error}</div></div> : null}

      <section className={styles.statGrid}>
        <article className={styles.statCard}><span>Original Invoice</span><strong>{formatMoney(Number(invoice.total_amount), invoice.currency)}</strong><small>Permanent issued amount</small></article>
        <article className={styles.statCard}><span>Credit Notes</span><strong>{formatMoney(Number(invoice.credited_amount), invoice.currency)}</strong><small>{bundle.creditNotes.length} linked Credit Note{bundle.creditNotes.length === 1 ? "" : "s"}</small></article>
        <article className={styles.statCard}><span>Payments allocated</span><strong>{formatMoney(Number(invoice.allocated_amount), invoice.currency)}</strong><small>{bundle.payments.length} linked Payment{bundle.payments.length === 1 ? "" : "s"}</small></article>
        <article className={styles.statCard}><span>Remaining balance</span><strong>{formatMoney(Number(invoice.outstanding_amount), invoice.currency)}</strong><small>Live account balance, separate from the Invoice</small></article>
      </section>

      <section className={styles.detailGrid}>
        <article className={styles.detailCard}>
          <h3>Customer</h3>
          <div className={styles.kv}>
            <div className={styles.kvRow}><span>Name</span><strong>{invoice.customer_name_snapshot}</strong></div>
            <div className={styles.kvRow}><span>Code</span><strong>{invoice.customer_code_snapshot}</strong></div>
            <div className={styles.kvRow}><span>VAT</span><strong>{invoice.customer_vat_number_snapshot || "—"}</strong></div>
            <div className={styles.kvRow}><span>Email</span><strong>{bundle.customer?.email || "—"}</strong></div>
          </div>
        </article>
        <article className={styles.detailCard}>
          <h3>Invoice identity</h3>
          <div className={styles.kv}>
            <div className={styles.kvRow}><span>Issued</span><strong>{formatDate(invoice.issued_at)}</strong></div>
            <div className={styles.kvRow}><span>SO reference</span><strong>{invoice.sales_order_reference || "—"}</strong></div>
            <div className={styles.kvRow}><span>Payment state</span><strong>{invoice.payment_status.replaceAll("_", " ")}</strong></div>
            <div className={styles.kvRow}><span>Currency</span><strong>{invoice.currency}</strong></div>
          </div>
        </article>
        <article className={styles.detailCard}>
          <h3>Tax totals</h3>
          <div className={styles.kv}>
            <div className={styles.kvRow}><span>Net</span><strong>{formatMoney(Number(invoice.net_amount), invoice.currency)}</strong></div>
            <div className={styles.kvRow}><span>VAT</span><strong>{formatMoney(Number(invoice.vat_amount), invoice.currency)}</strong></div>
            <div className={styles.kvRow}><span>Discount</span><strong>{formatMoney(Number(invoice.discount_amount), invoice.currency)}</strong></div>
            <div className={styles.kvRow}><span>Total</span><strong>{formatMoney(Number(invoice.total_amount), invoice.currency)}</strong></div>
          </div>
        </article>
        <article className={styles.detailCard}>
          <h3>Context</h3>
          <p className={styles.muted}>{invoice.description || "No customer-facing description."}</p>
          {invoice.notes ? <p className={styles.muted}>Internal: {invoice.notes}</p> : null}
        </article>
      </section>

      <section className={styles.detailCard}>
        <h3>Invoice lines</h3>
        <div className={styles.tableScroll}>
          <table className={styles.lineTable}>
            <thead><tr><th>Code</th><th>Description</th><th>Qty</th><th className={styles.money}>Unit excl. VAT</th><th className={styles.money}>Discount</th><th className={styles.money}>VAT</th><th className={styles.money}>Total</th></tr></thead>
            <tbody>{invoice.invoice_lines.map((line) => <tr key={line.id}><td>{line.code_snapshot}</td><td>{line.description_snapshot}</td><td>{Number(line.quantity).toLocaleString()}</td><td className={styles.money}>{formatMoney(Number(line.unit_price), invoice.currency)}</td><td className={styles.money}>{Number(line.discount_amount) ? formatMoney(Number(line.discount_amount), invoice.currency) : "—"}</td><td className={styles.money}>{Number(line.vat_rate).toLocaleString()}% · {formatMoney(Number(line.vat_amount), invoice.currency)}</td><td className={styles.money}>{formatMoney(Number(line.total_amount), invoice.currency)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className={styles.detailGrid}>
        <article className={styles.detailCard}>
          <h3><FileMinus2 size={16} /> Credit Notes</h3>
          <div className={styles.linkList}>{bundle.creditNotes.length ? bundle.creditNotes.map((note) => <div className={styles.linkRow} key={note.id}><span><strong>{note.number}</strong><span className={styles.subtle}>{note.reason} · {formatDate(note.issued_at ?? note.created_at)}</span></span><strong>{formatMoney(Number(note.total_amount), note.currency)}</strong></div>) : <span className={styles.muted}>No Credit Notes linked.</span>}</div>
        </article>
        <article className={styles.detailCard}>
          <h3><Banknote size={16} /> Payments</h3>
          <div className={styles.linkList}>{bundle.payments.length ? bundle.payments.map((payment) => <div className={styles.linkRow} key={payment.id}><span><strong>{payment.reference}</strong><span className={styles.subtle}>{payment.payment_method.replaceAll("_", " ")} · {formatDate(payment.received_at)}</span></span><strong>{formatMoney(Number(payment.allocated_to_invoice), payment.currency)}</strong></div>) : <span className={styles.muted}>No Payments allocated.</span>}</div>
        </article>
        <article className={styles.detailCard}>
          <h3><PackageCheck size={16} /> Delivery Notes</h3>
          <div className={styles.linkList}>{bundle.deliveryNotes.length ? bundle.deliveryNotes.map((note) => <div className={styles.linkRow} key={note.id}><span><strong>{note.number}</strong><span className={styles.subtle}>{formatDate(note.delivery_date)} · {note.status}</span></span></div>) : <span className={styles.muted}>No Delivery Notes linked.</span>}</div>
        </article>
        <article className={styles.detailCard}>
          <h3><MessageSquareText size={16} /> Internal history</h3>
          <div className={styles.linkList}>{bundle.notes.length ? bundle.notes.map((note) => <div className={styles.linkRow} key={note.id}><span><strong>{note.note}</strong><span className={styles.subtle}>{formatDate(note.created_at)}</span></span></div>) : <span className={styles.muted}>No internal notes.</span>}</div>
          {noteRuntime.error ? <div className={styles.inlineNotice}>{noteRuntime.error}</div> : null}
          {noteRuntime.notice ? <div className={styles.inlineNotice}>{noteRuntime.notice}</div> : null}
          <form className={styles.noteForm} onSubmit={addNote}>
            <label htmlFor="invoice-internal-note">Append an internal Note</label>
            <textarea id="invoice-internal-note" required maxLength={2000} value={newNote} onChange={(event) => setNewNote(event.target.value)} placeholder="Add context without changing the issued Invoice…" />
            <button className={styles.secondaryLink} type="submit" disabled={!newNote.trim() || Boolean(noteRuntime.busy) || noteRuntime.loading || noteRuntime.supportReadOnly}><MessageSquarePlus size={15} /> {noteRuntime.busy ? "Saving…" : "Append Note"}</button>
          </form>
        </article>
      </section>
    </main>
  );
}
