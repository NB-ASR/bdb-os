"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AccountsComposerFrame } from "./accounts-composer-frame";
import styles from "./accounts-composer.module.css";

type Identity = {
  businessAddress: string;
  vatNumber: string;
  companyRegistrationNumber: string;
  creditNotePrefix: string;
  deliveryNotePrefix: string;
  paymentTermsDays: string;
  documentFooter: string;
};

const EMPTY_IDENTITY: Identity = {
  businessAddress: "",
  vatNumber: "",
  companyRegistrationNumber: "",
  creditNotePrefix: "CN",
  deliveryNotePrefix: "DN",
  paymentTermsDays: "14",
  documentFooter: "",
};

export function DocumentIdentitySettings() {
  const [workspaceId, setWorkspaceId] = useState("");
  const [identity, setIdentity] = useState(EMPTY_IDENTITY);
  const [online, setOnline] = useState(true);
  const [supportReadOnly, setSupportReadOnly] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) throw new Error(context.error ?? "The current workspace could not be resolved.");
      const id = String(context.currentWorkspaceId);
      const response = await fetch(`/api/workspace/document-identity?workspaceId=${encodeURIComponent(id)}`, { cache: "no-store" });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Document setup could not be loaded.");
      const value = result.result ?? {};
      setWorkspaceId(id);
      setSupportReadOnly(Boolean(context.supportAccess && context.supportAccessMode !== "test_write"));
      setIdentity({
        businessAddress: value.businessAddress ?? "",
        vatNumber: value.vatNumber ?? "",
        companyRegistrationNumber: value.companyRegistrationNumber ?? "",
        creditNotePrefix: value.creditNotePrefix ?? "CN",
        deliveryNotePrefix: value.deliveryNotePrefix ?? "DN",
        paymentTermsDays: String(value.paymentTermsDays ?? 14),
        documentFooter: value.documentFooter ?? "",
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Document setup could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function update<Key extends keyof Identity>(key: Key, value: Identity[Key]) {
    setIdentity((current) => ({ ...current, [key]: value }));
  }

  async function save(event: FormEvent) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!online) return setError("Reconnect before changing business-document setup.");
    if (!workspaceId || supportReadOnly) return setError("This Accounts workspace is read-only for the current session.");

    setSaving(true);
    try {
      const response = await fetch("/api/workspace/document-identity", {
        method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": crypto.randomUUID() },
        body: JSON.stringify({ ...identity, workspaceId, paymentTermsDays: Number(identity.paymentTermsDays) }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) throw new Error(result.error ?? "Document setup could not be saved.");
      setNotice("Business-document setup saved. Existing issued documents remain unchanged.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Document setup could not be saved.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AccountsComposerFrame
      eyebrow="Accounts · Sales · Setup"
      title="Document setup"
      description="Set the business identity used for future documents. Issued document identity and branding snapshots remain frozen."
      backHref="/accounts/sales"
      backLabel="Sales"
      online={online}
      pendingCount={0}
      loading={loading}
      error={error}
      notice={notice}
      onDismissError={() => setError("")}
      onDismissNotice={() => setNotice("")}
    >
      <form className={styles.formPanel} onSubmit={save}>
        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><div><h2>Legal identity</h2><p>These details are applied to future issued business documents.</p></div></div>
          <div className={styles.formGrid}>
            <label className={`${styles.field} ${styles.wide}`}><span>Business address</span><textarea maxLength={1000} value={identity.businessAddress} onChange={(event) => update("businessAddress", event.target.value)} /></label>
            <label className={styles.field}><span>VAT number</span><input maxLength={64} value={identity.vatNumber} onChange={(event) => update("vatNumber", event.target.value)} /></label>
            <label className={styles.field}><span>Company registration number</span><input maxLength={64} value={identity.companyRegistrationNumber} onChange={(event) => update("companyRegistrationNumber", event.target.value)} /></label>
          </div>
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><div><h2>Document defaults</h2><p>Invoice numbering remains INV. Credit Note and Delivery Note sequences remain independent per workspace.</p></div></div>
          <div className={styles.formGrid}>
            <label className={styles.field}><span>Credit Note prefix</span><input required maxLength={8} pattern="[A-Za-z0-9-]+" value={identity.creditNotePrefix} onChange={(event) => update("creditNotePrefix", event.target.value.toUpperCase())} /></label>
            <label className={styles.field}><span>Delivery Note prefix</span><input required maxLength={8} pattern="[A-Za-z0-9-]+" value={identity.deliveryNotePrefix} onChange={(event) => update("deliveryNotePrefix", event.target.value.toUpperCase())} /></label>
            <label className={styles.field}><span>Payment terms (days)</span><input required type="number" min="0" max="365" step="1" value={identity.paymentTermsDays} onChange={(event) => update("paymentTermsDays", event.target.value)} /></label>
            <label className={`${styles.field} ${styles.wide}`}><span>Document footer</span><textarea maxLength={1000} value={identity.documentFooter} onChange={(event) => update("documentFooter", event.target.value)} /></label>
          </div>
        </section>

        <footer className={styles.actions}><span className={styles.hint}>Documents freeze. Business settings evolve.</span><div><button type="submit" disabled={loading || saving || supportReadOnly || !online}>{saving ? "Saving…" : "Save setup"}</button></div></footer>
      </form>
    </AccountsComposerFrame>
  );
}
