"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Building2,
  CheckCircle2,
  CreditCard,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import { BdbBrand } from "@/components/bdb-brand";
import { Badge, Button, Card, Dialog } from "@/components/ui";
import { featureCatalog, planCatalog } from "@/lib/saas/catalog";
import type { FeatureKey, PlanCode } from "@/lib/saas/types";
import { useSaas } from "@/lib/saas/context";

interface AdminClient {
  id: string;
  name: string;
  slug: string;
  status: "trial" | "active" | "suspended" | "cancelled";
  planCode: PlanCode;
  planName: string;
  memberCount: number;
  contract: null | {
    id: string;
    status: string;
    minimumTermMonths: 3 | 6;
    monthlyAmount: number | null;
    currency: "GBP" | "EUR" | "USD";
    startsOn: string | null;
    minimumEndsOn: string | null;
  };
  features: Record<FeatureKey, boolean>;
}

export default function AdminPage() {
  const { loading: contextLoading, mode } = useSaas();
  const [clients, setClients] = useState<AdminClient[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [forbidden, setForbidden] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/workspaces", { cache: "no-store" });
    if (response.status === 401 || response.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const result = await response.json() as { clients?: AdminClient[]; error?: string };
    if (!response.ok || !result.clients) setError(result.error ?? "Could not load client workspaces.");
    else {
      setClients(result.clients);
      setSelectedId((current) => current ?? result.clients?.[0]?.id ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (contextLoading) return;
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
  }, [contextLoading, load]);

  const selected = clients.find((client) => client.id === selectedId) ?? null;
  const filtered = clients.filter((client) => `${client.name} ${client.slug}`.toLowerCase().includes(query.toLowerCase()));
  const activeCount = clients.filter((client) => client.status === "active").length;
  const monthlyValue = clients.reduce((sum, client) => sum + (client.contract?.monthlyAmount ?? 0), 0);

  if (forbidden) return <AdminAccessRequired />;

  return (
    <div className="admin-page">
      <header className="admin-header"><BdbBrand href="/admin" /><div className="admin-header-actions"><span><ShieldCheck size={15} /> Founder control centre</span><Link href="/workspace"><ArrowLeft size={15} /> Client workspace</Link><form action="/auth/signout" method="post"><button>Sign out</button></form></div></header>
      <main className="admin-main">
        <div className="admin-title"><div><p className="eyebrow">BDB platform administration</p><h1>Client workspaces</h1><p>Control access, bespoke contracts and the exact capabilities enabled for every business.</p></div><Button onClick={() => setCreateOpen(true)}><Plus size={17} /> Add a client</Button></div>
        {mode === "demo" ? <div className="admin-demo-note"><AlertTriangle size={16} /><span>Preview data is shown until the Supabase production environment is connected.</span></div> : null}
        <div className="admin-stats"><Card><Building2 /><span><small>Client workspaces</small><strong>{clients.length}</strong></span></Card><Card><CheckCircle2 /><span><small>Active contracts</small><strong>{activeCount}</strong></span></Card><Card><CreditCard /><span><small>Quoted monthly value</small><strong>{new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(monthlyValue)}</strong></span></Card><Card><Users /><span><small>Workspace users</small><strong>{clients.reduce((sum, client) => sum + client.memberCount, 0)}</strong></span></Card></div>
        {error ? <div className="form-error admin-error">{error}<button onClick={() => void load()}><RefreshCw size={14} /> Retry</button></div> : null}
        <div className="admin-workspace-layout">
          <Card className="admin-client-list">
            <div className="admin-list-search"><Search size={16} /><input aria-label="Search clients" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search clients" /></div>
            {loading ? <div className="page-loading"><span /></div> : filtered.map((client) => <button key={client.id} className={selectedId === client.id ? "active" : ""} onClick={() => setSelectedId(client.id)}><span className="client-monogram">{client.name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("")}</span><span><strong>{client.name}</strong><small>{client.planName} · {client.memberCount} user{client.memberCount === 1 ? "" : "s"}</small></span><Badge tone={client.status === "active" ? "green" : client.status === "suspended" ? "red" : "gold"}>{client.status}</Badge></button>)}
            {!loading && !filtered.length ? <p className="admin-empty">No clients match that search.</p> : null}
          </Card>
          {selected ? <ClientEditor key={`${selected.id}-${JSON.stringify(selected)}`} client={selected} onSaved={(client) => { setClients((current) => current.map((item) => item.id === client.id ? client : item)); setNotice(`${client.name} updated`); window.setTimeout(() => setNotice(""), 2200); }} /> : <Card className="admin-empty-panel"><SlidersHorizontal /><h2>Select a client</h2><p>Choose a workspace to review its contract and enabled capabilities.</p></Card>}
        </div>
      </main>
      <NewClientDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); setNotice("Client invited and workspace created"); void load(); }} />
      {notice ? <div className="toast"><CheckCircle2 size={17} /> {notice}</div> : null}
    </div>
  );
}

function ClientEditor({ client, onSaved }: { client: AdminClient; onSaved: (client: AdminClient) => void }) {
  const [form, setForm] = useState(client);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const enabledCount = useMemo(() => Object.values(form.features).filter(Boolean).length, [form.features]);

  function changePlan(planCode: PlanCode) {
    const plan = planCatalog.find((item) => item.code === planCode)!;
    setForm({ ...form, planCode, planName: plan.name, features: Object.fromEntries(featureCatalog.map((feature) => [feature.key, plan.features.includes(feature.key)])) as Record<FeatureKey, boolean> });
  }

  async function save() {
    setSaving(true);
    setError("");
    const response = await fetch("/api/admin/workspaces", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: form.id, planCode: form.planCode, status: form.status, minimumTermMonths: form.contract?.minimumTermMonths ?? 3, monthlyAmount: form.contract?.monthlyAmount ?? null, currency: form.contract?.currency ?? "GBP", features: form.features }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) setError(result.error ?? "Could not save this workspace.");
    else onSaved(form);
    setSaving(false);
  }

  return <Card className="admin-editor"><div className="admin-editor-heading"><div><p className="eyebrow">{client.slug}</p><h2>{client.name}</h2><p>Changes affect this client only.</p></div><label>Status<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value as AdminClient["status"] })}><option value="trial">Trial</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option></select></label></div><section><h3>Commercial agreement</h3><p className="muted">The plan is a starting point. Quote and entitlements remain specific to this contract.</p><div className="admin-contract-grid"><div className="field"><label>Reference plan</label><select value={form.planCode} onChange={(event) => changePlan(event.target.value as PlanCode)}>{planCatalog.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></div><div className="field"><label>Minimum term</label><select value={form.contract?.minimumTermMonths ?? 3} onChange={(event) => setForm({ ...form, contract: { ...(form.contract ?? emptyContract), minimumTermMonths: Number(event.target.value) as 3 | 6 } })}><option value="3">3 months</option><option value="6">6 months</option></select></div><div className="field"><label>Monthly quote</label><div className="money-input"><select aria-label="Currency" value={form.contract?.currency ?? "GBP"} onChange={(event) => setForm({ ...form, contract: { ...(form.contract ?? emptyContract), currency: event.target.value as "GBP" | "EUR" | "USD" } })}><option>GBP</option><option>EUR</option><option>USD</option></select><input aria-label="Monthly amount" min="0" step="0.01" type="number" value={form.contract?.monthlyAmount ?? ""} placeholder="Not set" onChange={(event) => setForm({ ...form, contract: { ...(form.contract ?? emptyContract), monthlyAmount: event.target.value === "" ? null : Number(event.target.value) } })} /></div></div></div></section><section><div className="admin-feature-heading"><div><h3>Enabled capabilities</h3><p className="muted">{enabledCount} of {featureCatalog.length} capabilities enabled.</p></div><button onClick={() => setForm({ ...form, features: Object.fromEntries(featureCatalog.map((feature) => [feature.key, true])) as Record<FeatureKey, boolean> })}>Enable all</button></div><div className="admin-feature-grid">{featureCatalog.map((feature) => <label key={feature.key} className={form.features[feature.key] ? "enabled" : ""}><input type="checkbox" checked={Boolean(form.features[feature.key])} onChange={(event) => setForm({ ...form, features: { ...form.features, [feature.key]: event.target.checked } })} /><span><strong>{feature.shortName}</strong><small>{feature.description}</small></span><i /></label>)}</div></section>{error ? <p className="form-error">{error}</p> : null}<div className="admin-save-bar"><span><LockKeyhole size={14} /> All changes are recorded in the audit log.</span><Button onClick={() => void save()} disabled={saving}><Save size={16} /> {saving ? "Saving…" : "Save client setup"}</Button></div></Card>;
}

const emptyContract: NonNullable<AdminClient["contract"]> = { id: "", status: "sent", minimumTermMonths: 3, monthlyAmount: null, currency: "GBP", startsOn: null, minimumEndsOn: null };

function NewClientDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({ name: "", email: "", planCode: "starter" as PlanCode, minimumTermMonths: 3 as 3 | 6, monthlyAmount: "", currency: "GBP" as "GBP" | "EUR" | "USD" });

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const response = await fetch("/api/admin/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...form, monthlyAmount: form.monthlyAmount === "" ? null : Number(form.monthlyAmount) }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) setError(result.error ?? "Could not create this client.");
    else onCreated();
    setSaving(false);
  }

  return <Dialog open={open} onClose={onClose} title="Add a client workspace" description="Creates a private workspace and emails the owner a secure invitation."><form onSubmit={submit}><div className="form-grid"><div className="field"><label htmlFor="client-name">Business name</label><input id="client-name" required minLength={2} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div className="field"><label htmlFor="client-email">Owner email</label><input id="client-email" required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div><div className="field"><label htmlFor="client-plan">Reference plan</label><select id="client-plan" value={form.planCode} onChange={(event) => setForm({ ...form, planCode: event.target.value as PlanCode })}>{planCatalog.map((plan) => <option key={plan.code} value={plan.code}>{plan.name}</option>)}</select></div><div className="field"><label htmlFor="client-term">Minimum term</label><select id="client-term" value={form.minimumTermMonths} onChange={(event) => setForm({ ...form, minimumTermMonths: Number(event.target.value) as 3 | 6 })}><option value="3">3 months</option><option value="6">6 months</option></select></div><div className="field"><label htmlFor="client-currency">Currency</label><select id="client-currency" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as typeof form.currency })}><option>GBP</option><option>EUR</option><option>USD</option></select></div><div className="field"><label htmlFor="client-amount">Monthly quote</label><input id="client-amount" type="number" min="0" step="0.01" value={form.monthlyAmount} onChange={(event) => setForm({ ...form, monthlyAmount: event.target.value })} placeholder="Can be set later" /></div></div>{error ? <p className="form-error" style={{ marginTop: 16 }}>{error}</p> : null}<div className="dialog-actions"><Button type="button" variant="secondary" onClick={onClose}>Cancel</Button><Button type="submit" disabled={saving}><Plus size={16} /> {saving ? "Creating…" : "Create & invite"}</Button></div></form></Dialog>;
}

function AdminAccessRequired() {
  return <main className="admin-access"><BdbBrand /><span><ShieldCheck size={36} /></span><p className="eyebrow">Restricted BDB administration</p><h1>Founder verification required</h1><p>This area is only available to approved BDB platform administrators after multi-factor authentication. Client workspace owners cannot access it.</p><Link className="button button-primary" href="/mfa">Complete secure verification</Link><Link className="button button-secondary" href="/workspace">Return to workspace</Link></main>;
}
