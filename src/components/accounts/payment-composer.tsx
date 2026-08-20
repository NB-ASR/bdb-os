"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { AccountsComposerFrame } from "./accounts-composer-frame";
import { useAccountsCommandRuntime } from "./accounts-command-runtime";
import type { CustomerOption, PaymentMethod } from "./composer-types";
import { CustomerPicker } from "./customer-picker";
import styles from "./accounts-composer.module.css";

function localDateTime() {
  const date = new Date();
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export function PaymentComposer() {
  const router = useRouter();
  const runtime = useAccountsCommandRuntime();
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("bank_transfer");
  const [receivedAt, setReceivedAt] = useState(localDateTime());
  const [externalReference, setExternalReference] = useState("");
  const [notes, setNotes] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!customer) return runtime.setError("Choose the Customer who made this Payment.");
    const paymentAmount = Number(amount);
    if (!(paymentAmount > 0)) return runtime.setError("Payment amount must be greater than zero.");

    const result = await runtime.dispatch("payment-record", {
      id: crypto.randomUUID(),
      customerId: customer.id,
      amount: paymentAmount,
      paymentMethod: method,
      receivedAt: new Date(receivedAt).toISOString(),
      externalReference: externalReference.trim(),
      notes: notes.trim(),
      allocations: [],
    });
    if (result.ok) router.push(result.pending ? "/accounts" : "/accounts/payments");
  }

  return (
    <AccountsComposerFrame
      eyebrow="Accounts · Payments"
      title="Record Payment"
      description="Record money received as its own accounting event. It changes the live Customer balance, never the original Invoice document."
      backHref="/accounts/payments"
      backLabel="Payments"
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
          <div className={styles.sectionHeading}><div><h2>Customer</h2><p>Payments remain attached to the canonical Customer account.</p></div></div>
          <CustomerPicker workspaceId={runtime.workspaceId} value={customer} onChange={setCustomer} />
        </section>

        <section className={styles.formSection}>
          <div className={styles.sectionHeading}><div><h2>Payment record</h2><p>Banking will later prove this record through reconciliation; it does not rewrite allocations.</p></div></div>
          <div className={styles.formGrid}>
            <label className={styles.field}><span>Amount</span><input required min="0.01" step="0.01" type="number" value={amount} onChange={(event) => setAmount(event.target.value)} /></label>
            <label className={styles.field}><span>Method</span><select value={method} onChange={(event) => setMethod(event.target.value as PaymentMethod)}><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cash">Cash</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
            <label className={styles.field}><span>Received</span><input required type="datetime-local" value={receivedAt} onChange={(event) => setReceivedAt(event.target.value)} /></label>
            <label className={styles.field}><span>External reference</span><input maxLength={160} value={externalReference} onChange={(event) => setExternalReference(event.target.value)} placeholder="Bank or receipt reference" /></label>
            <label className={`${styles.field} ${styles.wide}`}><span>Internal notes</span><textarea maxLength={2000} value={notes} onChange={(event) => setNotes(event.target.value)} /></label>
          </div>
        </section>

        <footer className={styles.actions}><span className={styles.hint}>This Payment will initially remain unallocated and visible for finance review.</span><div><button type="button" onClick={() => router.push("/accounts/payments")}>Cancel</button><button type="submit" disabled={Boolean(runtime.busy) || runtime.supportReadOnly}>Record Payment</button></div></footer>
      </form>
    </AccountsComposerFrame>
  );
}
