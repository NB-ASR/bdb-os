"use client";

import { Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { AccountsComposerFrame } from "./accounts-composer-frame";
import { useAccountsCommandRuntime } from "./accounts-command-runtime";
import type { CustomerOption, DeliverySourceType } from "./composer-types";
import { CustomerPicker } from "./customer-picker";
import styles from "./accounts-composer.module.css";

type SourceOption = {
  id: string;
  number?: string;
  reference?: string;
  customer_id: string;
  customer_name_snapshot: string;
};

type SourceDetail = {
  id: string;
  number?: string;
  reference?: string;
  customer_id: string;
  customer_name_snapshot?: string;
  customer: { id: string; name: string; address: string | null } | null;
  lines: Array<{ id: string; code: string; description: string; quantity: number }>;
};

type DeliveryLine = {
  id: string;
  sourceLineId: string;
  code: string;
  description: string;
  selected: boolean;
  quantity: string;
};

function localDate() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function manualLine(): DeliveryLine {
  return { id: crypto.randomUUID(), sourceLineId: "", code: "", description: "", selected: true, quantity: "1" };
}

export function DeliveryNoteComposer() {
  const router = useRouter();
  const runtime = useAccountsCommandRuntime();
  const workspaceId = runtime.workspaceId;
  const setRuntimeError = runtime.setError;
  const [type, setType] = useState<DeliverySourceType>("manual");
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [sourceQuery, setSourceQuery] = useState("");
  const [sources, setSources] = useState<SourceOption[]>([]);
  const [source, setSource] = useState<SourceDetail | null>(null);
  const [sourceLoading, setSourceLoading] = useState(false);
  const [deliveryDate, setDeliveryDate] = useState(localDate());
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<DeliveryLine[]>([manualLine()]);

  useEffect(() => {
    if (!workspaceId || type === "manual") return;
    let active = true;
    const timer = window.setTimeout(async () => {
      setSourceLoading(true);
      try {
        const params = new URLSearchParams({ workspaceId, resource: "delivery-sources", sourceType: type });
        if (sourceQuery.trim()) params.set("q", sourceQuery.trim());
        const response = await fetch(`/api/accounts/composer?${params.toString()}`, { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || !result.ok) throw new Error(result.error ?? "Delivery sources could not be searched.");
        if (active) setSources(result.result?.sources ?? []);
      } catch (lookupError) {
        if (active) setRuntimeError(lookupError instanceof Error ? lookupError.message : "Delivery sources could not be searched.");
      } finally {
        if (active) setSourceLoading(false);
      }
    }, sourceQuery ? 250 : 0);
    return () => { active = false; window.clearTimeout(timer); };
  }, [setRuntimeError, sourceQuery, type, workspaceId]);

  function changeType(next: DeliverySourceType) {
    setType(next);
    setSource(null);
    setSourceQuery("");
    setSources([]);
    setCustomer(null);
    setDeliveryAddress("");
    setLines(next === "manual" ? [manualLine()] : []);
  }

  async function chooseSource(option: SourceOption) {
    if (!workspaceId || type === "manual") return;
    setSourceLoading(true);
    setRuntimeError("");
    try {
      const params = new URLSearchParams({ workspaceId, resource: "delivery-source", sourceType: type, id: option.id });
      const response = await fetch(`/api/accounts/composer?${params.toString()}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Delivery source could not be opened.");
      const detail = result.result?.source as SourceDetail;
      setSource(detail);
      setSourceQuery(detail.number ?? detail.reference ?? "");
      setDeliveryAddress(detail.customer?.address ?? "");
      setLines((detail.lines ?? []).map((line) => ({ id: crypto.randomUUID(), sourceLineId: line.id, code: line.code, description: line.description, selected: true, quantity: String(line.quantity) })));
    } catch (lookupError) {
      setRuntimeError(lookupError instanceof Error ? lookupError.message : "Delivery source could not be opened.");
    } finally {
      setSourceLoading(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (type === "manual" && !customer) return runtime.setError("Choose the Customer receiving this Delivery Note.");
    if (type !== "manual" && !source) return runtime.setError("Choose the issued Invoice or completed Sale being delivered.");
    const selected = lines.filter((line) => line.selected && Number(line.quantity) > 0);
    if (!selected.length) return runtime.setError("Add or select at least one delivered quantity.");

    const result = await runtime.dispatch("delivery-note-create", {
      id: crypto.randomUUID(),
      sourceType: type,
      sourceId: type === "manual" ? null : source?.id,
      customerId: type === "manual" ? customer?.id : null,
      deliveryDate,
      deliveryAddress: deliveryAddress.trim(),
      notes: notes.trim(),
      lines: type === "manual"
        ? selected.map((line) => ({ id: line.id, code: line.code.trim(), description: line.description.trim(), quantity: Number(line.quantity) }))
        : selected.map((line) => ({ id: line.id, sourceLineId: line.sourceLineId, quantity: Number(line.quantity) })),
    });
    if (result.ok) router.push(result.pending ? "/accounts" : "/accounts/sales/delivery-notes");
  }

  return (
    <AccountsComposerFrame
      eyebrow="Accounts · Sales · Delivery Note"
      title="New Delivery Note"
      description="Record fulfilment without changing the Customer balance. The issued Delivery Note becomes permanent."
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
          <div className={styles.sectionHeading}><div><h2>Delivery source</h2><p>Create a standalone note or link it to an authoritative commercial record.</p></div></div>
          <label className={styles.field}><span>Source type</span><select value={type} onChange={(event) => changeType(event.target.value as DeliverySourceType)}><option value="manual">Standalone Delivery Note</option><option value="invoice">Issued Invoice</option><option value="sale">Completed Sale</option></select></label>
          {type === "manual" ? <CustomerPicker workspaceId={workspaceId} value={customer} onChange={(next) => { setCustomer(next); setDeliveryAddress(next?.address ?? ""); }} /> : <div className={styles.lookup}>
            <label className={styles.searchField}><span>Find {type === "invoice" ? "Invoice" : "Sale"}</span><span className={styles.searchInput}><Search size={15} /><input value={sourceQuery} onChange={(event) => { setSourceQuery(event.target.value); setSource(null); setLines([]); }} placeholder={type === "invoice" ? "Invoice number or Customer…" : "Sale reference…"} /></span></label>
            {source ? <div className={styles.selectedRecord}><span><strong>{source.number ?? source.reference} · {source.customer?.name ?? source.customer_name_snapshot ?? "Customer"}</strong><small>{source.lines.length} source line{source.lines.length === 1 ? "" : "s"}</small></span></div> : null}
            {!source ? <div className={styles.sourceResults}>{sources.map((option) => <button type="button" key={option.id} onClick={() => void chooseSource(option)}><span><strong>{option.number ?? option.reference}</strong><small>{option.customer_name_snapshot}</small></span></button>)}{!sources.length ? <span className={styles.lookupEmpty}>{sourceLoading ? "Searching sources…" : "No matching sources."}</span> : null}</div> : null}
          </div>}
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><div><h2>Delivery details</h2><p>The delivery date and address are frozen with the issued document.</p></div></div>
          <div className={styles.formGrid}><label className={styles.field}><span>Delivery date</span><input required type="date" value={deliveryDate} onChange={(event) => setDeliveryDate(event.target.value)} /></label><label className={styles.field}><span>Delivery address</span><input maxLength={1000} value={deliveryAddress} onChange={(event) => setDeliveryAddress(event.target.value)} /></label></div>
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><div><h2>Items delivered</h2><p>{type === "manual" ? "Describe the standalone delivery exactly as it should appear." : "Select genuine quantities from the linked source."}</p></div>{type === "manual" ? <button className={styles.secondaryLink} type="button" onClick={() => setLines((current) => [...current, manualLine()])}><Plus size={14} /> Add line</button> : null}</div>
          {type === "manual" ? <div className={styles.lineList}>{lines.map((line, index) => <div className={styles.invoiceLine} key={line.id}><label className={styles.field}><span>Description</span><input required maxLength={240} value={line.description} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /></label><label className={styles.field}><span>Code</span><input maxLength={64} value={line.code} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, code: event.target.value } : item))} /></label><label className={styles.field}><span>Qty</span><input required min="0.001" step="0.001" type="number" value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label><button className={styles.removeButton} type="button" aria-label="Remove delivery line" disabled={lines.length === 1} onClick={() => setLines((current) => current.filter((item) => item.id !== line.id))}><X size={16} /></button></div>)}</div> : <div className={styles.selectionList}>{lines.map((line, index) => <label className={styles.selectionRow} key={line.id}><input type="checkbox" checked={line.selected} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} /><span><strong>{line.code ? `${line.code} · ` : ""}{line.description}</strong><small>Quantity being delivered</small></span><input type="number" min="0.001" step="0.001" disabled={!line.selected} value={line.quantity} onChange={(event) => setLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, quantity: event.target.value } : item))} /></label>)}</div>}
        </section>

        <section className={styles.formSection}><div className={styles.sectionHeading}><div><h2>Internal context</h2><p>Append private creation context without changing the commercial meaning.</p></div></div><label className={`${styles.field} ${styles.wide}`}><span>Internal note</span><textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label></section>
        <footer className={styles.actions}><span className={styles.hint}>Delivery Notes have no effect on receivables or Payments.</span><div><button type="button" onClick={() => router.push("/accounts/sales/delivery-notes")}>Cancel</button><button type="submit" disabled={Boolean(runtime.busy) || runtime.supportReadOnly}>Create Delivery Note</button></div></footer>
      </form>
    </AccountsComposerFrame>
  );
}
