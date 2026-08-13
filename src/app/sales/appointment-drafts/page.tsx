"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CalendarCheck2,
  CheckCircle2,
  CircleDollarSign,
  FilePenLine,
  ReceiptText,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { Badge, Button, Card, Dialog, PageHeader, SectionHeading, StatCard } from "@/components/ui";
import styles from "./appointment-drafts.module.css";

type DraftStatus = "open" | "discarded" | "converted";

type CompletedAppointment = {
  id: string;
  reference: string;
  customer_id: string;
  customer_name_snapshot: string | null;
  service_id: string;
  service_code_snapshot: string | null;
  title: string;
  price_snapshot: number | null;
  vat_rate_snapshot: number;
  completed_at: string;
  status: "completed";
};

type SaleDraft = {
  id: string;
  workspace_id: string;
  reference: string;
  source_appointment_id: string;
  customer_id: string;
  service_id: string;
  customer_name_snapshot: string;
  service_code_snapshot: string;
  service_name_snapshot: string;
  currency: string;
  quantity: number;
  unit_price: number | null;
  discount_amount: number;
  vat_rate: number;
  occurred_at: string;
  notes: string | null;
  status: DraftStatus;
  version: number;
  converted_sale_id: string | null;
  converted_at: string | null;
  discard_reason: string | null;
  updated_at: string;
};

type DraftBundle = {
  workspaceId: string;
  canManage: boolean;
  drafts: SaleDraft[];
  completedAppointments: CompletedAppointment[];
};

type ReviewForm = {
  unitPrice: string;
  discountAmount: string;
  occurredAt: string;
  notes: string;
};

const emptyBundle: DraftBundle = {
  workspaceId: "",
  canManage: false,
  drafts: [],
  completedAppointments: [],
};

function localDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function reviewForm(draft: SaleDraft): ReviewForm {
  return {
    unitPrice: draft.unit_price === null ? "" : String(draft.unit_price),
    discountAmount: String(draft.discount_amount),
    occurredAt: localDateTime(draft.occurred_at),
    notes: draft.notes ?? "",
  };
}

function roundMoney(value: number) {
  return Math.round((value + Number.EPSILON) * 10000) / 10000;
}

function draftTotals(draft: SaleDraft, form: ReviewForm) {
  const unitPrice = Number(form.unitPrice || 0);
  const discount = Number(form.discountAmount || 0);
  const gross = roundMoney(Number(draft.quantity) * unitPrice);
  const total = roundMoney(Math.max(0, gross - discount));
  const vat = Number(draft.vat_rate) === 0
    ? 0
    : roundMoney(total * Number(draft.vat_rate) / (100 + Number(draft.vat_rate)));
  return { gross, discount, vat, total };
}

function formatter(currency: string) {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency });
}

export default function AppointmentSaleDraftsPage() {
  const router = useRouter();
  const { state } = useBdb();
  const [bundle, setBundle] = useState<DraftBundle>(emptyBundle);
  const [loading, setLoading] = useState(true);
  const [online, setOnline] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewing, setReviewing] = useState<SaleDraft | null>(null);
  const [form, setForm] = useState<ReviewForm>({ unitPrice: "", discountAmount: "0", occurredAt: "", notes: "" });
  const [discarding, setDiscarding] = useState<SaleDraft | null>(null);
  const [discardReason, setDiscardReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const contextResponse = await fetch("/api/workspace/context", { cache: "no-store" });
      const context = await contextResponse.json().catch(() => ({}));
      if (!contextResponse.ok || !context.currentWorkspaceId) {
        throw new Error(context.error ?? "The current workspace could not be resolved.");
      }

      const response = await fetch(
        `/api/sale-drafts?workspaceId=${encodeURIComponent(String(context.currentWorkspaceId))}`,
        { cache: "no-store" },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok) {
        throw new Error(result.error ?? "Appointment Sale drafts could not be loaded.");
      }
      setBundle(result.result as DraftBundle);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Appointment Sale drafts could not be loaded.");
    } finally {
      setLoading(false);
    }
  }, []);

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

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const draftsByAppointment = useMemo(
    () => new Map(bundle.drafts.map((draft) => [draft.source_appointment_id, draft])),
    [bundle.drafts],
  );
  const awaitingDraft = bundle.completedAppointments.filter((appointment) => !draftsByAppointment.has(appointment.id));
  const openDrafts = bundle.drafts.filter((draft) => draft.status === "open");
  const discardedDrafts = bundle.drafts.filter((draft) => draft.status === "discarded");
  const convertedDrafts = bundle.drafts.filter((draft) => draft.status === "converted");
  const disabled = !bundle.canManage || !online;
  const totals = reviewing ? draftTotals(reviewing, form) : null;
  const workspaceCurrency = formatter(state.settings.currency);

  async function command(action: string, payload: Record<string, unknown>) {
    const response = await fetch("/api/sale-drafts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ workspaceId: bundle.workspaceId, action, ...payload }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? "Appointment Sale draft could not be saved.");
    }
    return result.result as { draft?: SaleDraft; sale?: Record<string, unknown> };
  }

  async function createDraft(appointment: CompletedAppointment) {
    if (disabled) return;
    setBusy(appointment.id);
    setError("");
    setNotice("");
    try {
      await command("create", { id: crypto.randomUUID(), appointmentId: appointment.id });
      setNotice(`${appointment.reference} is ready for Sales review.`);
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Sale draft could not be created.");
    } finally {
      setBusy("");
    }
  }

  function openReview(draft: SaleDraft) {
    setReviewing(draft);
    setForm(reviewForm(draft));
    setError("");
    setNotice("");
  }

  async function saveReview() {
    if (!reviewing || disabled || !form.occurredAt) return null;
    setBusy(reviewing.id);
    setError("");
    try {
      const result = await command("update", {
        id: reviewing.id,
        expectedVersion: reviewing.version,
        unitPrice: form.unitPrice,
        discountAmount: form.discountAmount,
        occurredAt: new Date(form.occurredAt).toISOString(),
        notes: form.notes,
      });
      const updated = result.draft ?? null;
      if (updated) {
        setReviewing(updated);
        setForm(reviewForm(updated));
      }
      setNotice("Appointment Sale draft review saved.");
      await load();
      return updated;
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Sale draft review could not be saved.");
      return null;
    } finally {
      setBusy("");
    }
  }

  async function completeSale() {
    if (!reviewing || disabled) return;
    const unitPrice = Number(form.unitPrice);
    const discountAmount = Number(form.discountAmount || 0);
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      setError("Enter a valid Service price before completing the Sale.");
      return;
    }
    if (!Number.isFinite(discountAmount) || discountAmount < 0 || discountAmount > Number(reviewing.quantity) * unitPrice) {
      setError("The discount cannot exceed the Service value.");
      return;
    }
    if (!form.occurredAt) {
      setError("Choose the Sale date and time.");
      return;
    }

    setBusy(reviewing.id);
    setError("");
    setNotice("");
    try {
      const updateResult = await command("update", {
        id: reviewing.id,
        expectedVersion: reviewing.version,
        unitPrice,
        discountAmount,
        occurredAt: new Date(form.occurredAt).toISOString(),
        notes: form.notes,
      });
      const updated = updateResult.draft;
      if (!updated) throw new Error("The reviewed draft could not be reloaded.");

      await command("complete", {
        id: updated.id,
        expectedVersion: updated.version,
        saleId: crypto.randomUUID(),
      });
      setReviewing(null);
      setNotice("Appointment Sale completed. Settlement remains not recorded.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Appointment Sale could not be completed.");
    } finally {
      setBusy("");
    }
  }

  async function discardDraft() {
    if (!discarding || disabled || discardReason.trim().length < 2) return;
    setBusy(discarding.id);
    setError("");
    try {
      await command("discard", {
        id: discarding.id,
        expectedVersion: discarding.version,
        reason: discardReason.trim(),
      });
      setDiscarding(null);
      setDiscardReason("");
      setNotice("Appointment Sale draft discarded without creating a Sale.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Sale draft could not be discarded.");
    } finally {
      setBusy("");
    }
  }

  async function restoreDraft(draft: SaleDraft) {
    if (disabled) return;
    setBusy(draft.id);
    setError("");
    try {
      await command("restore", { id: draft.id, expectedVersion: draft.version });
      setNotice("Appointment Sale draft restored for review.");
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Sale draft could not be restored.");
    } finally {
      setBusy("");
    }
  }

  if (loading && !bundle.workspaceId) {
    return <main className="admin-loading"><RefreshCw className="spin" size={20} /> Loading Appointment Sale drafts…</main>;
  }

  return (
    <>
      <PageHeader
        eyebrow="Sales workflow"
        title="Appointment Sale drafts"
        description="Turn completed Appointments into reviewed, immutable service Sales without implying payment, invoicing or stock movement."
        action={(
          <div className={styles.headerActions}>
            <Button variant="secondary" onClick={() => router.push("/calendar")}>Open Calendar</Button>
            <Button variant="secondary" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={loading ? "spin" : ""} size={16} /> Refresh
            </Button>
          </div>
        )}
      />

      <div className="review-callout">
        <ShieldCheck size={19} />
        <div>
          <strong>Review before commercial completion</strong>
          <p>A completed Appointment creates no Sale automatically. Sales must create and review the draft, then complete the immutable transaction explicitly.</p>
        </div>
      </div>

      {!online ? (
        <Card className="settings-note">
          <strong>Online connection required</strong>
          <p>Appointment Sale draft creation and conversion are online-only because the one-to-one Appointment link and Sale completion must be checked atomically.</p>
        </Card>
      ) : null}
      {!bundle.canManage ? (
        <Card className="settings-note">
          <strong>Read-only Sales drafts</strong>
          <p>Sales create permission or guarded Founder test-write access is required to create, review or complete these drafts.</p>
        </Card>
      ) : null}
      {error ? <Card className="settings-note"><strong>Action needed</strong><p>{error}</p></Card> : null}
      {notice ? <div className="toast"><CheckCircle2 size={17} /> {notice}</div> : null}

      <div className="stat-grid">
        <StatCard label="Awaiting draft" value={String(awaitingDraft.length)} detail="Completed Appointments" icon={<CalendarCheck2 size={19} />} />
        <StatCard label="Open drafts" value={String(openDrafts.length)} detail="Require Sales review" icon={<FilePenLine size={19} />} />
        <StatCard label="Converted" value={String(convertedDrafts.length)} detail="Immutable Sales created" icon={<ReceiptText size={19} />} />
        <StatCard label="Discarded" value={String(discardedDrafts.length)} detail="No Sale created" icon={<Trash2 size={19} />} />
      </div>

      <div className={styles.grid}>
        <Card className="settings-card">
          <SectionHeading title="Completed Appointments" description="Create one Sales-owned draft for each completed Appointment that still requires commercial review." />
          <div className={styles.cardBody}>
            {awaitingDraft.length ? (
              <div className={styles.rowList}>
                {awaitingDraft.map((appointment) => (
                  <div className={styles.row} key={appointment.id}>
                    <div className={styles.identity}>
                      <span className={styles.identityIcon}><CalendarCheck2 size={18} /></span>
                      <div className={styles.identityText}>
                        <strong>{appointment.customer_name_snapshot || "Customer"} · {appointment.title}</strong>
                        <span>{appointment.reference} · {appointment.service_code_snapshot || "Service"}</span>
                        <small>{new Date(appointment.completed_at).toLocaleString("en-GB")} · {appointment.price_snapshot === null ? "Price review required" : workspaceCurrency.format(Number(appointment.price_snapshot))}</small>
                      </div>
                    </div>
                    <div className={styles.rowActions}>
                      <Button onClick={() => void createDraft(appointment)} disabled={disabled || busy === appointment.id}>
                        <FilePenLine size={16} /> {busy === appointment.id ? "Creating…" : "Create draft"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className={styles.empty}>
                <CalendarCheck2 size={24} />
                <strong>No completed Appointments are awaiting a draft.</strong>
                <span>Complete an Appointment in Calendar, then return here.</span>
              </div>
            )}
          </div>
        </Card>

        <Card className="settings-card">
          <SectionHeading title="Draft register" description="Open, discarded and converted Appointment Sale drafts remain linked to their source Appointment." />
          <div className={styles.cardBody}>
            {bundle.drafts.length ? (
              <div className={styles.rowList}>
                {bundle.drafts.map((draft) => {
                  const currency = formatter(draft.currency);
                  const amount = draft.unit_price === null
                    ? "Price required"
                    : currency.format(Math.max(0, Number(draft.quantity) * Number(draft.unit_price) - Number(draft.discount_amount)));
                  return (
                    <div className={styles.row} key={draft.id}>
                      <div className={styles.identity}>
                        <span className={styles.identityIcon}><ReceiptText size={18} /></span>
                        <div className={styles.identityText}>
                          <strong>{draft.customer_name_snapshot} · {draft.service_name_snapshot}</strong>
                          <span>{draft.reference} · {draft.service_code_snapshot}</span>
                          <div className={styles.meta}>
                            <Badge tone={draft.status === "open" ? "gold" : draft.status === "converted" ? "green" : "neutral"}>{draft.status}</Badge>
                            <small>{amount}</small>
                          </div>
                        </div>
                      </div>
                      <div className={styles.rowActions}>
                        {draft.status === "open" ? (
                          <>
                            <Button variant="secondary" onClick={() => openReview(draft)} disabled={busy === draft.id}><FilePenLine size={15} /> Review</Button>
                            <Button variant="quiet" onClick={() => { setDiscarding(draft); setDiscardReason(""); }} disabled={disabled || busy === draft.id}><Trash2 size={15} /> Discard</Button>
                          </>
                        ) : null}
                        {draft.status === "discarded" ? (
                          <Button variant="secondary" onClick={() => void restoreDraft(draft)} disabled={disabled || busy === draft.id}><RotateCcw size={15} /> Restore</Button>
                        ) : null}
                        {draft.status === "converted" ? (
                          <Button variant="quiet" onClick={() => router.push("/sales")}><ReceiptText size={15} /> Open Sales</Button>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className={styles.empty}>
                <ReceiptText size={24} />
                <strong>No Appointment Sale drafts exist.</strong>
                <span>Create one from a completed Appointment.</span>
              </div>
            )}
          </div>
        </Card>
      </div>

      <Dialog
        open={reviewing !== null}
        onClose={() => setReviewing(null)}
        title={reviewing ? `${reviewing.customer_name_snapshot} · ${reviewing.service_name_snapshot}` : "Review Appointment Sale draft"}
        description="Review the commercial values before creating the immutable Sale."
      >
        {reviewing && totals ? (
          <div className={styles.formBody}>
            <div className={styles.formGrid}>
              <label>Service price
                <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={(event) => setForm((current) => ({ ...current, unitPrice: event.target.value }))} disabled={disabled || busy === reviewing.id} />
              </label>
              <label>Discount
                <input type="number" min="0" step="0.01" value={form.discountAmount} onChange={(event) => setForm((current) => ({ ...current, discountAmount: event.target.value }))} disabled={disabled || busy === reviewing.id} />
              </label>
              <label className={styles.full}>Sale date and time
                <input type="datetime-local" value={form.occurredAt} onChange={(event) => setForm((current) => ({ ...current, occurredAt: event.target.value }))} disabled={disabled || busy === reviewing.id} />
              </label>
              <label className={styles.full}>Sales notes
                <textarea rows={4} maxLength={1000} value={form.notes} onChange={(event) => setForm((current) => ({ ...current, notes: event.target.value }))} disabled={disabled || busy === reviewing.id} />
              </label>
            </div>

            <div className={styles.totalPanel}>
              <div><span>Gross</span><strong>{formatter(reviewing.currency).format(totals.gross)}</strong></div>
              <div><span>Discount</span><strong>{formatter(reviewing.currency).format(totals.discount)}</strong></div>
              <div><span>VAT included</span><strong>{formatter(reviewing.currency).format(totals.vat)}</strong></div>
              <div><span>Total</span><strong>{formatter(reviewing.currency).format(totals.total)}</strong></div>
            </div>

            <div className={styles.warning}>
              <TriangleAlert size={18} />
              <div><strong>Commercial boundary</strong><p>Completing this draft creates one service-only Sale. It does not record payment, issue an invoice, post Banking activity or move Inventory.</p></div>
            </div>

            <div className="dialog-actions">
              <Button variant="quiet" onClick={() => setReviewing(null)} disabled={busy === reviewing.id}>Close</Button>
              <Button variant="secondary" onClick={() => void saveReview()} disabled={disabled || busy === reviewing.id || !form.occurredAt}><FilePenLine size={16} /> Save review</Button>
              <Button onClick={() => void completeSale()} disabled={disabled || busy === reviewing.id || !form.unitPrice || !form.occurredAt}>
                <CircleDollarSign size={16} /> {busy === reviewing.id ? "Completing…" : "Complete Sale"}
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={discarding !== null}
        onClose={() => setDiscarding(null)}
        title="Discard Appointment Sale draft"
        description="The completed Appointment remains in Calendar. No Sale will be created."
      >
        <div className={styles.formBody}>
          <label className={styles.full}>Reason
            <textarea rows={4} minLength={2} maxLength={500} value={discardReason} onChange={(event) => setDiscardReason(event.target.value)} disabled={!discarding || busy === discarding.id} />
          </label>
          <div className="dialog-actions">
            <Button variant="quiet" onClick={() => setDiscarding(null)}>Keep draft</Button>
            <Button variant="danger" onClick={() => void discardDraft()} disabled={!discarding || disabled || busy === discarding.id || discardReason.trim().length < 2}>
              <Trash2 size={16} /> Discard draft
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
