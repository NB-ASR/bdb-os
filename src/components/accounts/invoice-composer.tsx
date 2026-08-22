"use client";

import { Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { formatMoney } from "@/lib/format";
import { calculateInvoiceTotals } from "@/lib/invoice-pricing";
import {
  cacheAccountsCatalogue,
  cacheAccountsSettings,
  readAccountsSettings,
  searchAccountsCatalogue,
} from "@/lib/modules/accounts-working-cache";
import { AccountsComposerFrame } from "./accounts-composer-frame";
import { useAccountsCommandRuntime } from "./accounts-command-runtime";
import type { CatalogueOption, CustomerOption } from "./composer-types";
import { CustomerPicker } from "./customer-picker";
import styles from "./accounts-composer.module.css";

type DraftLine = {
  id: string;
  item: CatalogueOption;
  quantity: string;
  discountPercent: string;
};

function round4(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

export function InvoiceComposer() {
  const router = useRouter();
  const runtime = useAccountsCommandRuntime();
  const workspaceId = runtime.workspaceId;
  const setRuntimeError = runtime.setError;
  const [currency, setCurrency] = useState("EUR");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [salesOrderReference, setSalesOrderReference] = useState("");
  const [catalogueQuery, setCatalogueQuery] = useState("");
  const [catalogueKind, setCatalogueKind] = useState<"all" | "product" | "service">("all");
  const [catalogue, setCatalogue] = useState<CatalogueOption[]>([]);
  const [catalogueLoading, setCatalogueLoading] = useState(false);
  const [catalogueCached, setCatalogueCached] = useState(false);
  const [lines, setLines] = useState<DraftLine[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    const cached = readAccountsSettings(workspaceId);
    const cachedTimer = cached
      ? window.setTimeout(() => { if (active) setCurrency(cached.currency || "EUR"); }, 0)
      : null;
    if (!navigator.onLine) return () => {
      active = false;
      if (cachedTimer !== null) window.clearTimeout(cachedTimer);
    };

    async function loadSettings() {
      try {
        const params = new URLSearchParams({ workspaceId, resource: "settings" });
        const response = await fetch(`/api/accounts/composer?${params.toString()}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error ?? "Invoice settings could not be loaded.");
        const settings = result.result?.settings;
        if (settings) cacheAccountsSettings(workspaceId, settings);
        if (active) setCurrency(settings?.currency ?? cached?.currency ?? "EUR");
      } catch (lookupError) {
        if (active && !cached) setRuntimeError(lookupError instanceof Error ? lookupError.message : "Invoice settings could not be loaded.");
      }
    }
    void loadSettings();
    return () => {
      active = false;
      if (cachedTimer !== null) window.clearTimeout(cachedTimer);
    };
  }, [setRuntimeError, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      const local = searchAccountsCatalogue(workspaceId, catalogueQuery, catalogueKind) as CatalogueOption[];
      if (local.length && active) {
        setCatalogue(local);
        setCatalogueCached(true);
      }
      if (!navigator.onLine) {
        if (active) {
          setCatalogueLoading(false);
          if (!local.length) setRuntimeError("No cached catalogue items match this search. Reconnect to refresh the working set.");
        }
        return;
      }

      setCatalogueLoading(true);
      try {
        const params = new URLSearchParams({ workspaceId, resource: "catalogue", kind: catalogueKind });
        if (catalogueQuery.trim()) params.set("q", catalogueQuery.trim());
        const response = await fetch(`/api/accounts/composer?${params.toString()}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error ?? "The catalogue could not be searched.");
        const live = (result.result?.items ?? []) as CatalogueOption[];
        cacheAccountsCatalogue(workspaceId, live);
        if (active) {
          setCatalogue(live);
          setCatalogueCached(false);
        }
      } catch (lookupError) {
        if (!active) return;
        const fallback = searchAccountsCatalogue(workspaceId, catalogueQuery, catalogueKind) as CatalogueOption[];
        if (fallback.length) {
          setCatalogue(fallback);
          setCatalogueCached(true);
        } else {
          setRuntimeError(lookupError instanceof Error ? lookupError.message : "The catalogue could not be searched.");
        }
      } finally {
        if (active) setCatalogueLoading(false);
      }
    }, catalogueQuery ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [catalogueKind, catalogueQuery, setRuntimeError, workspaceId]);

  const needsSalesOrder = lines.some((line) => line.item.type === "product");
  const totals = useMemo(() => calculateInvoiceTotals(lines.map((line) => {
    const quantity = Number(line.quantity || 0);
    const unitPrice = Number(line.item.unitPrice ?? 0);
    const discountPercent = Math.min(Math.max(Number(line.discountPercent || 0), 0), 100);
    return {
      quantity,
      unitPrice,
      discountAmount: round4(quantity * unitPrice * discountPercent / 100),
      vatRate: Number(line.item.vatRate ?? 0),
    };
  })), [lines]);

  function addItem(item: CatalogueOption) {
    if (item.unitPrice == null) {
      runtime.setError(`${item.name} does not have an active catalogue selling price.`);
      return;
    }
    setLines((current) => [...current, { id: crypto.randomUUID(), item, quantity: "1", discountPercent: "0" }]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!customer) return runtime.setError("Choose the Customer being invoiced.");
    if (!lines.length) return runtime.setError("Add at least one catalogue Product or Service.");
    if (needsSalesOrder && !salesOrderReference.trim()) {
      return runtime.setError("A Sales Order reference is required because this Invoice contains Products.");
    }
    if (lines.some((line) => !(Number(line.quantity) > 0))) return runtime.setError("Every Invoice quantity must be greater than zero.");

    const invoiceId = crypto.randomUUID();
    const result = await runtime.dispatch("invoice-create-manual", {
      id: invoiceId,
      customerId: customer.id,
      description: description.trim() || "Invoice",
      notes: notes.trim(),
      salesOrderReference: needsSalesOrder ? salesOrderReference.trim() : null,
      lines: lines.map((line) => ({
        id: line.id,
        lineType: line.item.type,
        productId: line.item.type === "product" ? line.item.id : null,
        serviceId: line.item.type === "service" ? line.item.id : null,
        quantity: Number(line.quantity),
        discountPercent: Math.min(Math.max(Number(line.discountPercent || 0), 0), 100),
        catalogueUnitPrice: Number(line.item.unitPrice),
        catalogueVatRate: Number(line.item.vatRate),
      })),
    });
    if (!result.ok) return;
    if (result.pending) router.push("/accounts");
    else router.push(`/accounts/sales/invoices/${invoiceId}`);
  }

  return (
    <AccountsComposerFrame
      eyebrow="Accounts · Sales · Invoice"
      title="New Invoice"
      description="Issue the official document now. Catalogue price and VAT stay authoritative; Discount % is the controlled commercial adjustment."
      backHref="/accounts/sales"
      backLabel="Sales"
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
          <div className={styles.sectionHeading}><div><h2>Customer</h2><p>Every Invoice belongs to one canonical Customer record.</p></div></div>
          <CustomerPicker workspaceId={workspaceId} value={customer} onChange={setCustomer} />
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><div><h2>Catalogue items</h2><p>Search the Product and Service working set. Cached items remain available offline and are revalidated before issue.</p></div></div>
          <div className={styles.catalogueToolbar}>
            <label className={styles.searchField}><span>Search catalogue</span><span className={styles.searchInput}><Search size={15} /><input value={catalogueQuery} onChange={(event) => setCatalogueQuery(event.target.value)} placeholder="Code or name…" /></span></label>
            <label className={styles.field}><span>Type</span><select value={catalogueKind} onChange={(event) => setCatalogueKind(event.target.value as typeof catalogueKind)}><option value="all">Products & Services</option><option value="product">Products</option><option value="service">Services</option></select></label>
          </div>
          <div className={styles.catalogueResults}>
            {catalogue.map((item) => <button key={`${item.type}:${item.id}`} type="button" onClick={() => addItem(item)}><span><strong>{item.code} · {item.name}</strong><small>{item.type} · VAT {Number(item.vatRate).toLocaleString()}%</small></span><strong><Plus size={13} /> {item.unitPrice == null ? "No price" : formatMoney(Number(item.unitPrice), currency)}</strong></button>)}
            {!catalogue.length ? <span className={styles.lookupEmpty}>{catalogueLoading ? "Searching catalogue…" : "No matching catalogue items."}</span> : null}
            {catalogueCached && catalogue.length ? <span className={styles.lookupEmpty}>Cached catalogue working set · price and VAT will be checked again before issue.</span> : null}
          </div>
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><div><h2>Invoice lines</h2><p>Quantity and Discount % are editable. Price and VAT are validated against the catalogue again when the Invoice is issued.</p></div></div>
          <div className={styles.lineList}>
            {lines.map((line, index) => (
              <div className={styles.invoiceLine} key={line.id}>
                <div className={styles.lineIdentity}><strong>{line.item.code} · {line.item.name}</strong><small>{line.item.type}</small></div>
                <label className={styles.field}><span>Qty</span><input required min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label>
                <label className={styles.field}><span>Price excl. VAT</span><input readOnly value={formatMoney(Number(line.item.unitPrice ?? 0), currency)} /></label>
                <label className={styles.field}><span>Discount %</span><input min="0" max="100" step="0.01" type="number" value={line.discountPercent} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, discountPercent: event.target.value } : item))} /></label>
                <label className={styles.field}><span>VAT %</span><input readOnly value={Number(line.item.vatRate).toLocaleString()} /></label>
                <button className={styles.removeButton} type="button" aria-label={`Remove ${line.item.name}`} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><X size={16} /></button>
              </div>
            ))}
            {!lines.length ? <span className={styles.lookupEmpty}>Add catalogue items above to build this Invoice.</span> : null}
          </div>
          <div className={styles.summary}><div><span>Subtotal</span><strong>{formatMoney(totals.netAmount, currency)}</strong></div><div><span>VAT</span><strong>{formatMoney(totals.vatAmount, currency)}</strong></div><div><span>Total</span><strong>{formatMoney(totals.totalAmount, currency)}</strong></div></div>
        </section>

        {needsSalesOrder ? <section className={styles.formSection}><div className={styles.sectionHeading}><div><h2>Sales Order bridge</h2><p>A Product or mixed Invoice requires its Sales Order reference.</p></div></div><label className={`${styles.field} ${styles.wide}`}><span>Sales Order reference</span><input required maxLength={64} value={salesOrderReference} onChange={(event) => setSalesOrderReference(event.target.value)} placeholder="SO123" /></label></section> : null}

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><div><h2>Message and internal context</h2><p>Customer-facing description and private operational notes remain separate.</p></div></div>
          <div className={styles.copyGrid}><label className={styles.field}><span>Description · visible to Customer</span><textarea required maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What is this Invoice for?" /></label><label className={styles.field}><span>Internal notes</span><textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Private context for your team" /></label></div>
        </section>

        <footer className={styles.actions}><span className={styles.hint}>If catalogue price or VAT changed while offline, sync stops for review instead of changing money silently.</span><div><button type="button" onClick={() => router.push("/accounts/sales/invoices")}>Cancel</button><button type="submit" disabled={Boolean(runtime.busy) || runtime.loading || runtime.supportReadOnly}>Create Invoice</button></div></footer>
      </form>
    </AccountsComposerFrame>
  );
}
