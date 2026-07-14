"use client";

import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import {
  Accessibility,
  Check,
  CheckCircle2,
  DatabaseBackup,
  MonitorCog,
  Palette,
  RotateCcw,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
} from "lucide-react";
import { useBdb } from "@/lib/store";
import { useSaas } from "@/lib/saas/context";
import { featureCatalog, planCatalog, themePresets } from "@/lib/saas/catalog";
import type { WorkspaceTheme } from "@/lib/saas/types";
import { createClient } from "@/lib/supabase/client";
import { Button, Card, PageHeader, SectionHeading } from "@/components/ui";
import { PwaInstallButton } from "@/components/pwa-install";
import type { BusinessSettings } from "@/lib/types";

type SettingsTab = "business" | "appearance" | "plan";

export default function SettingsPage() {
  return <Suspense fallback={<div className="page-loading"><span /><p>Opening settings…</p></div>}><SettingsContent /></Suspense>;
}

function SettingsContent() {
  const searchParams = useSearchParams();
  const { state, ready, updateSettings, resetDemo } = useBdb();
  const { mode, workspace, theme, hasFeature, updateTheme } = useSaas();
  const initialTab = searchParams.get("tab");
  const [tab, setTab] = useState<SettingsTab>(initialTab === "appearance" || initialTab === "plan" ? initialTab : "business");

  if (!ready) return null;

  return (
    <>
      <PageHeader eyebrow="Workspace preferences" title="Settings" description="Make BDB OS fit the business, the contract and the people using it." />
      <div className="settings-tabs" role="tablist" aria-label="Settings sections">
        <button className={tab === "business" ? "active" : ""} onClick={() => setTab("business")}><MonitorCog size={16} /> Business</button>
        {hasFeature("appearance") ? <button className={tab === "appearance" ? "active" : ""} onClick={() => setTab("appearance")}><Palette size={16} /> Appearance</button> : null}
        <button className={tab === "plan" ? "active" : ""} onClick={() => setTab("plan")}><SlidersHorizontal size={16} /> Plan & access</button>
      </div>
      {tab === "business" ? <BusinessSettingsForm key={JSON.stringify(state.settings)} initial={state.settings} updateSettings={updateSettings} resetDemo={resetDemo} demo={mode === "demo"} /> : null}
      {tab === "appearance" && hasFeature("appearance") ? <AppearanceForm key={JSON.stringify(theme)} initial={theme} updateTheme={updateTheme} /> : null}
      {tab === "plan" ? <PlanPanel planCode={workspace?.planCode ?? "pro"} planName={workspace?.planName ?? "Pro"} hasFeature={hasFeature} /> : null}
    </>
  );
}

function BusinessSettingsForm({ initial, updateSettings, resetDemo, demo }: {
  initial: BusinessSettings;
  updateSettings: (settings: BusinessSettings) => void;
  resetDemo: () => void;
  demo: boolean;
}) {
  const [form, setForm] = useState<BusinessSettings>(initial);
  const [saved, setSaved] = useState(false);

  function submit(event: FormEvent) {
    event.preventDefault();
    updateSettings(form);
    setSaved(true);
    window.setTimeout(() => setSaved(false), 2200);
  }

  return (
    <>
      <div className="settings-layout">
        <Card className="settings-card">
          <SectionHeading title="Business profile" description="Used across invoices, messages and reports." />
          <form onSubmit={submit}>
            <div className="form-grid">
              <div className="field"><label htmlFor="business-name">Business name</label><input id="business-name" required value={form.businessName} onChange={(event) => setForm({ ...form, businessName: event.target.value })} /></div>
              <div className="field"><label htmlFor="owner-name">Owner name</label><input id="owner-name" required value={form.ownerName} onChange={(event) => setForm({ ...form, ownerName: event.target.value })} /></div>
              <div className="field"><label htmlFor="business-email">Business email</label><input id="business-email" required type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
              <div className="field"><label htmlFor="business-phone">Phone</label><input id="business-phone" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
              <div className="field"><label htmlFor="currency">Currency</label><select id="currency" value={form.currency} onChange={(event) => setForm({ ...form, currency: event.target.value as BusinessSettings["currency"] })}><option value="GBP">GBP · British pound</option><option value="EUR">EUR · Euro</option><option value="USD">USD · US dollar</option></select></div>
              <div className="field"><label htmlFor="invoice-prefix">Invoice prefix</label><input id="invoice-prefix" required maxLength={8} value={form.invoicePrefix} onChange={(event) => setForm({ ...form, invoicePrefix: event.target.value.toUpperCase() })} /></div>
              <div className="field"><label htmlFor="vat-rate">VAT rate (%)</label><input id="vat-rate" min="0" max="100" type="number" value={form.vatRate} onChange={(event) => setForm({ ...form, vatRate: Number(event.target.value) })} /></div>
            </div>
            <div className="dialog-actions"><Button type="submit"><Save size={16} /> Save business profile</Button></div>
          </form>
        </Card>
        <div>
          <Card className="settings-note"><ShieldCheck size={22} /><h2 style={{ marginTop: 10 }}>Private by design</h2><p>Every live record includes your workspace identity and is protected by database-level access rules. Another client cannot query your data.</p></Card>
          <Card className="settings-note" style={{ marginTop: 14 }}><DatabaseBackup size={22} /><h2 style={{ marginTop: 10 }}>Secure continuity</h2><p>Live data is synced to your company workspace. Private pages are not placed in the shared offline browser cache.</p>{demo ? <div className="danger-zone"><h3>Reset sample workspace</h3><p>Restore the original demonstration data and remove local changes.</p><Button variant="danger" onClick={() => { if (window.confirm("Reset all local BDB OS demo data?")) resetDemo(); }}><RotateCcw size={15} /> Reset demo data</Button></div> : null}</Card>
        </div>
      </div>
      {saved ? <div className="toast"><CheckCircle2 size={17} /> Business profile saved</div> : null}
    </>
  );
}

function AppearanceForm({ initial, updateTheme }: { initial: WorkspaceTheme; updateTheme: (theme: WorkspaceTheme) => Promise<{ error?: string }> }) {
  const [form, setForm] = useState(initial);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    document.documentElement.style.setProperty("--accent", form.accentColor);
    document.documentElement.style.setProperty("--gold", form.accentColor);
    document.documentElement.dataset.themeMode = form.mode;
    document.documentElement.dataset.themeFont = form.fontFamily;
    document.documentElement.dataset.themeDensity = form.density;
    document.documentElement.dataset.highContrast = String(form.highContrast);
    document.documentElement.dataset.reducedMotion = String(form.reducedMotion);
    document.documentElement.style.setProperty("--font-scale", String(form.textScale));
    return () => {
      document.documentElement.style.setProperty("--accent", initial.accentColor);
      document.documentElement.style.setProperty("--gold", initial.accentColor);
      document.documentElement.dataset.themeMode = initial.mode;
      document.documentElement.dataset.themeFont = initial.fontFamily;
      document.documentElement.dataset.themeDensity = initial.density;
      document.documentElement.dataset.highContrast = String(initial.highContrast);
      document.documentElement.dataset.reducedMotion = String(initial.reducedMotion);
      document.documentElement.style.setProperty("--font-scale", String(initial.textScale));
    };
  }, [form, initial]);

  async function save() {
    setStatus("saving");
    setError("");
    const result = await updateTheme(form);
    if (result.error) {
      setError(result.error);
      setStatus("idle");
      return;
    }
    setStatus("saved");
    window.setTimeout(() => setStatus("idle"), 2200);
  }

  return (
    <div className="appearance-layout">
      <Card className="settings-card appearance-controls">
        <SectionHeading title="Workspace theme" description="Personal to this company and shared across its signed-in devices." />
        <div className="theme-presets">
          {Object.entries(themePresets).map(([key, preset]) => <button key={key} className={form.preset === key ? "active" : ""} onClick={() => setForm({ ...form, preset: key as WorkspaceTheme["preset"], accentColor: preset.accentColor, mode: preset.mode })}><span style={{ background: preset.preview }} />{preset.label}{form.preset === key ? <Check size={14} /> : null}</button>)}
        </div>
        <div className="appearance-fields">
          <div className="field"><label htmlFor="theme-mode">Light or dark</label><select id="theme-mode" value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as WorkspaceTheme["mode"] })}><option value="dark">Dark</option><option value="light">Light</option><option value="system">Follow this device</option></select></div>
          <div className="field"><label htmlFor="theme-font">Typography</label><select id="theme-font" value={form.fontFamily} onChange={(event) => setForm({ ...form, fontFamily: event.target.value as WorkspaceTheme["fontFamily"] })}><option value="manrope">Manrope · Modern</option><option value="dm-sans">DM Sans · Friendly</option><option value="system">System · Familiar</option><option value="serif">Serif · Traditional</option></select></div>
          <div className="field"><label htmlFor="theme-density">Spacing</label><select id="theme-density" value={form.density} onChange={(event) => setForm({ ...form, density: event.target.value as WorkspaceTheme["density"] })}><option value="compact">Compact</option><option value="comfortable">Comfortable</option><option value="spacious">Spacious</option></select></div>
          <div className="field color-field"><label htmlFor="accent-color">Accent colour</label><div><input id="accent-color" type="color" value={form.accentColor} onChange={(event) => setForm({ ...form, preset: "custom", accentColor: event.target.value })} /><code>{form.accentColor.toUpperCase()}</code></div></div>
          <div className="field field-full"><label htmlFor="text-scale">Text size · {Math.round(form.textScale * 100)}%</label><input id="text-scale" type="range" min="0.9" max="1.2" step="0.05" value={form.textScale} onChange={(event) => setForm({ ...form, textScale: Number(event.target.value) })} /></div>
        </div>
        <div className="accessibility-options">
          <label><input type="checkbox" checked={form.highContrast} onChange={(event) => setForm({ ...form, highContrast: event.target.checked })} /><span><Accessibility size={18} /><b>Higher contrast</b><small>Strengthens borders and secondary text.</small></span></label>
          <label><input type="checkbox" checked={form.reducedMotion} onChange={(event) => setForm({ ...form, reducedMotion: event.target.checked })} /><span><Accessibility size={18} /><b>Reduce motion</b><small>Minimises transitions and animations.</small></span></label>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="dialog-actions"><Button variant="secondary" onClick={() => setForm(initial)}><RotateCcw size={15} /> Undo preview</Button><Button onClick={() => void save()} disabled={status === "saving"}><Save size={16} /> {status === "saving" ? "Saving…" : "Save appearance"}</Button></div>
      </Card>
      <Card className="theme-preview-card"><p className="eyebrow">Live preview</p><h2>Your business, your workspace.</h2><p>Appearance changes apply immediately so you can judge them before saving.</p><div className="theme-preview-stat"><span>Appointments today</span><strong>4</strong></div><div className="theme-preview-row"><i /><span><b>Customer follow-up</b><small>Automation ready for approval</small></span><button>Review</button></div></Card>
      {status === "saved" ? <div className="toast"><CheckCircle2 size={17} /> Appearance saved across your workspace</div> : null}
    </div>
  );
}

function PlanPanel({ planCode, planName, hasFeature }: { planCode: "starter" | "growth" | "pro"; planName: string; hasFeature: (key: (typeof featureCatalog)[number]["key"]) => boolean }) {
  const reference = planCatalog.find((plan) => plan.code === planCode);
  const enabled = featureCatalog.filter((feature) => hasFeature(feature.key));
  const unavailable = featureCatalog.filter((feature) => !hasFeature(feature.key));
  return <div className="plan-settings"><Card className="settings-card plan-summary"><div><p className="eyebrow">Current reference plan</p><h2>{planName}</h2><p>{reference?.description ?? "Your workspace has a bespoke set of enabled modules."}</p></div><span>Customised</span></Card><div className="two-column"><Card className="settings-card"><SectionHeading title="Enabled for this workspace" description={`${enabled.length} capabilities are currently available under your contract.`} /><div className="entitlement-list">{enabled.map((feature) => <div key={feature.key}><CheckCircle2 size={17} /><span><strong>{feature.name}</strong><small>{feature.description}</small></span></div>)}</div></Card><div><BillingControl /><Card className="settings-note"><SlidersHorizontal size={22} /><h2 style={{ marginTop: 10 }}>Your contract is flexible</h2><p>BDB can add or remove modules as your needs change. Any change affecting price or commitment is agreed with you before it takes effect.</p><a className="button button-secondary plan-contact" href="mailto:support@bdb-os.co.uk?subject=Change%20our%20BDB%20OS%20features">Discuss a change</a></Card><Card className="settings-note mobile-install-card"><Smartphone size={22} /><h2 style={{ marginTop: 10 }}>BDB OS in your pocket</h2><p>Install the secure web app for a full-screen phone experience, quick appointments and home-screen access.</p><PwaInstallButton /></Card>{unavailable.length ? <Card className="settings-note unavailable-card"><h3>Available to add</h3><p>{unavailable.map((feature) => feature.shortName).join(" · ")}</p></Card> : null}</div></div></div>;
}

interface BillingSummary {
  status: string;
  monthly_amount: number | null;
  currency: "GBP" | "EUR" | "USD";
  minimum_term_months: 3 | 6;
  minimum_ends_on: string | null;
}

function BillingControl() {
  const { mode, workspace, role } = useSaas();
  const [contract, setContract] = useState<BillingSummary | null>(mode === "demo" ? { status: "active", monthly_amount: 349, currency: "GBP", minimum_term_months: 6, minimum_ends_on: "2027-01-01" } : null);
  const [accepted, setAccepted] = useState(false);
  const [loading, setLoading] = useState(mode === "live");
  const [error, setError] = useState("");

  useEffect(() => {
    if (mode === "demo" || !workspace) return;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase!.from("contracts").select("status, monthly_amount, currency, minimum_term_months, minimum_ends_on").eq("workspace_id", workspace!.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      setContract(data as BillingSummary | null);
      setLoading(false);
    }
    void load();
  }, [mode, workspace]);

  async function checkout() {
    setLoading(true);
    setError("");
    const response = await fetch("/api/billing/checkout", { method: "POST" });
    const result = await response.json() as { url?: string; error?: string };
    if (!response.ok || !result.url) {
      setError(result.error ?? "Could not open secure billing.");
      setLoading(false);
      return;
    }
    window.location.assign(result.url);
  }

  if (loading && !contract) return <Card className="settings-note billing-card"><div className="page-loading"><span /></div></Card>;
  if (!contract) return <Card className="settings-note billing-card"><h2>Contract & billing</h2><p>Your tailored proposal will appear here after BDB sends it.</p></Card>;
  const money = contract.monthly_amount === null ? "Quote pending" : new Intl.NumberFormat("en-GB", { style: "currency", currency: contract.currency }).format(contract.monthly_amount);
  const active = contract.status === "active";
  return <Card className="settings-note billing-card"><div className="billing-title"><div><p className="eyebrow">Contract & billing</p><h2>{money}<small> / month</small></h2></div><span className={active ? "active" : "pending"}>{contract.status}</span></div><div className="billing-detail"><span>Minimum commitment<strong>{contract.minimum_term_months} months</strong></span><span>Minimum term ends<strong>{contract.minimum_ends_on ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" }).format(new Date(`${contract.minimum_ends_on}T00:00:00`)) : "Begins on activation"}</strong></span></div>{!active && ["owner", "admin"].includes(role ?? "") && contract.monthly_amount ? <><label className="contract-accept"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>I accept this monthly quote and the {contract.minimum_term_months}-month minimum commitment.</span></label><Button className="plan-contact" disabled={!accepted || loading} onClick={() => void checkout()}>{loading ? "Opening Stripe…" : "Accept & set up secure billing"}</Button></> : null}{error ? <p className="form-error">{error}</p> : null}</Card>;
}
