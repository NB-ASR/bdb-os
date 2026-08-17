"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  Check,
  CreditCard,
  ImageIcon,
  ImageUp,
  KeyRound,
  Layers3,
  Link2,
  Loader2,
  MailCheck,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Unlink,
} from "lucide-react";
import { BdbMonogram } from "@/components/brand";

type Plan = { id: string; code: string; name: string; description: string; is_active: boolean };
type Feature = { key: string; name: string; description: string; category: string; route: string | null };
type Workspace = {
  id: string;
  name: string;
  legal_name: string | null;
  slug: string;
  status: string;
  plan_id: string | null;
  workspace_template_id: string | null;
  workspace_template_version: number | null;
  created_at: string;
};
type WorkspaceTemplate = {
  id: string;
  code: string;
  name: string;
  description: string;
  plan_id: string;
  version: number;
  is_active: boolean;
  is_default: boolean;
};
type Entitlement = { plan_id: string; feature_key: string; enabled: boolean };
type Override = { workspace_id: string; feature_key: string; enabled: boolean; reason: string | null };
type Subscription = { workspace_id: string; status: string; current_period_end: string | null };
type Contract = { workspace_id: string; minimum_term_months: number; monthly_amount: number | null; status: string };
type Membership = {
  workspace_id: string;
  user_id: string;
  role: string;
  access_profile: string;
  status: string;
  email: string;
  invitation_expires_at: string | null;
  invitation_last_sent_at: string | null;
  profiles?: { full_name?: string | null } | null;
};
type Group = { id: string; name: string; slug: string; created_at: string };
type GroupLink = { group_id: string; workspace_id: string; created_at: string };
type Audit = { id: number; action: string; created_at: string; workspace_id: string | null; metadata: Record<string, unknown> };
type Dashboard = {
  workspaces: Workspace[];
  plans: Plan[];
  features: Feature[];
  planFeatures: Entitlement[];
  overrides: Override[];
  templates: WorkspaceTemplate[];
  subscriptions: Subscription[];
  contracts: Contract[];
  memberships: Membership[];
  groups: Group[];
  groupLinks: GroupLink[];
  audit: Audit[];
};
type BrandingState = {
  workspaceId: string;
  workspaceName: string;
  logoPath: string | null;
  logoUrl: string | null;
  updatedAt: string | null;
};
type Tab = "clients" | "groups" | "plans" | "audit";
type ClientSection = "overview" | "access" | "billing" | "branding" | "owner";

const clientSections: Array<{ key: ClientSection; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "access", label: "Access & Modules" },
  { key: "billing", label: "Billing" },
  { key: "branding", label: "Branding" },
  { key: "owner", label: "Owner & Access" },
];

export default function AdminPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<Tab>("clients");
  const [selected, setSelected] = useState<string | null>(null);
  const [clientSection, setClientSection] = useState<ClientSection>("overview");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [branding, setBranding] = useState<BrandingState | null>(null);
  const [billingAmount, setBillingAmount] = useState("");
  const [billingTerm, setBillingTerm] = useState("6");
  const [billingTrial, setBillingTrial] = useState("0");
  const [supportReason, setSupportReason] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/admin", { cache: "no-store" });
    if (response.status === 428) { router.push("/mfa"); return; }
    if (response.status === 401) { router.push("/login?next=/admin"); return; }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error === "NOT_CONFIGURED" ? "Founder Admin is not connected to Supabase in this environment." : result.error ?? "Founder Admin could not be loaded.");
      return;
    }
    const dashboard = result as Dashboard;
    setData(dashboard);
    setSelected((current) => current && dashboard.workspaces.some((workspace) => workspace.id === current) ? current : dashboard.workspaces[0]?.id ?? null);
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeWorkspace = useMemo(
    () => data?.workspaces.find((workspace) => workspace.id === selected) ?? data?.workspaces[0] ?? null,
    [data, selected],
  );
  const activePlan = data?.plans.find((plan) => plan.id === activeWorkspace?.plan_id);
  const activeTemplate = data?.templates.find((template) => template.id === activeWorkspace?.workspace_template_id);
  const subscription = data?.subscriptions.find((item) => item.workspace_id === activeWorkspace?.id);
  const contract = data?.contracts.find((item) => item.workspace_id === activeWorkspace?.id);
  const owner = data?.memberships.find((membership) => membership.workspace_id === activeWorkspace?.id && membership.role === "owner");
  const activeGroupLink = data?.groupLinks.find((link) => link.workspace_id === activeWorkspace?.id);
  const activeGroup = data?.groups.find((group) => group.id === activeGroupLink?.group_id);
  const brandingFeature = data?.features.find((feature) => feature.key === "custom_branding") ?? null;
  const brandingOverride = data?.overrides.find((item) => item.workspace_id === activeWorkspace?.id && item.feature_key === "custom_branding");
  const brandingPlanEnabled = Boolean(data?.planFeatures.some((item) => item.plan_id === activeWorkspace?.plan_id && item.feature_key === "custom_branding" && item.enabled));
  const brandingEnabled = brandingOverride?.enabled ?? brandingPlanEnabled;

  useEffect(() => {
    setBillingAmount(contract?.monthly_amount ? String(contract.monthly_amount) : "");
    setBillingTerm(contract && [3, 6].includes(contract.minimum_term_months) ? String(contract.minimum_term_months) : "6");
    setBillingTrial("0");
    setSupportReason("");
    setBranding(null);
  }, [activeWorkspace?.id, contract?.minimum_term_months, contract?.monthly_amount]);

  const loadBranding = useCallback(async (workspaceId: string) => {
    setBusy("load-branding");
    setError("");
    const response = await fetch(`/api/admin/branding?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setBranding(null);
      setError(result.error ?? "Branding could not be loaded.");
      return;
    }
    setBranding(result as BrandingState);
  }, []);

  useEffect(() => {
    if (clientSection !== "branding" || !activeWorkspace?.id) return;
    const timer = window.setTimeout(() => void loadBranding(activeWorkspace.id), 0);
    return () => window.clearTimeout(timer);
  }, [activeWorkspace?.id, clientSection, loadBranding]);

  async function mutate(payload: Record<string, unknown>, key: string, success = "Change saved.") {
    setBusy(key);
    setError("");
    setNotice("");
    const response = await fetch("/api/admin", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setError(result.error ?? "The change could not be saved."); return false; }
    setNotice(success);
    await load();
    return true;
  }

  async function createGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("create-group");
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "create-group", name: form.get("name"), slug: form.get("slug") }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setError(result.error ?? "The group could not be created."); return; }
    event.currentTarget.reset();
    setNotice("Business Group created.");
    await load();
  }

  async function createBillingLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeWorkspace) return;
    const amount = Number(billingAmount);
    const term = Number(billingTerm);
    const trialDays = Number(billingTrial);
    if (!Number.isFinite(amount) || amount < 1 || ![3, 6].includes(term) || ![0, 7, 14, 30].includes(trialDays)) {
      setError("Enter a valid monthly quote, a 3 or 6 month term, and a supported trial period.");
      return;
    }
    setBusy("billing");
    setError("");
    setNotice("");
    const response = await fetch("/api/admin/billing-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: activeWorkspace.id, monthlyAmount: amount, termMonths: term, trialDays }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok || !result.url) {
      setError(result.error ?? "The billing link could not be created.");
      return;
    }
    setNotice("Billing link created. Stripe Checkout opened in a new tab.");
    window.open(result.url, "_blank", "noopener,noreferrer");
    await load();
  }

  async function uploadLogo(file?: File) {
    if (!file || !activeWorkspace) return;
    setBusy("upload-logo");
    setError("");
    setNotice("");
    const form = new FormData();
    form.set("workspaceId", activeWorkspace.id);
    form.set("file", file);
    const response = await fetch("/api/admin/branding", { method: "POST", body: form });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setError(result.error ?? "The company logo could not be uploaded.");
      return;
    }
    setNotice("Company logo saved. Enable Custom Business Branding when it should appear to the client.");
    await loadBranding(activeWorkspace.id);
  }

  async function removeLogo() {
    if (!activeWorkspace || !branding?.logoPath) return;
    if (!window.confirm(`Remove the saved logo for ${activeWorkspace.name}?`)) return;
    setBusy("remove-logo");
    setError("");
    setNotice("");
    const response = await fetch("/api/admin/branding", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId: activeWorkspace.id }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setError(result.error ?? "The saved logo could not be removed.");
      return;
    }
    setNotice("Company logo removed.");
    await loadBranding(activeWorkspace.id);
  }

  async function recordAdministrativeReason() {
    if (!activeWorkspace || !supportReason.trim()) return;
    const saved = await mutate(
      { action: "support-access", workspaceId: activeWorkspace.id, reason: supportReason.trim() },
      "support",
      "Administrative reason recorded in the audit trail.",
    );
    if (saved) setSupportReason("");
  }

  function selectClient(workspaceId: string) {
    setSelected(workspaceId);
    setClientSection("overview");
    setError("");
    setNotice("");
  }

  if (!data && !error) return <main className="admin-loading"><Loader2 className="spin" /> Loading secure control plane…</main>;
  if (!data) return (
    <main className="admin-loading" style={{ flexDirection: "column", gap: 14 }}>
      <ShieldCheck size={28} />
      <strong>Founder Admin unavailable</strong>
      <p>{error}</p>
      <button className="button button-secondary" onClick={() => void load()}><RefreshCw size={16} /> Retry</button>
    </main>
  );

  const pageTitle = tab === "clients"
    ? "Client businesses"
    : tab === "plans"
      ? "Plans & features"
      : tab === "groups"
        ? "Business groups"
        : "Audit trail";

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <BdbMonogram />
        <p className="admin-label">Founder control plane</p>
        <nav>
          <button className={tab === "clients" ? "active" : ""} onClick={() => setTab("clients")}><Building2 size={18} /> Clients</button>
          <button className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}><SlidersHorizontal size={18} /> Plans & Features</button>
          <button className={tab === "groups" ? "active" : ""} onClick={() => setTab("groups")}><Layers3 size={18} /> Business Groups</button>
          <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><Activity size={18} /> Audit Trail</button>
          <div className="admin-nav-divider" />
          <p className="admin-nav-group-label">Advanced</p>
          <Link href="/admin/templates"><Layers3 size={18} /> Workspace Templates</Link>
          <Link href="/admin/manual-provisioning"><KeyRound size={18} /> Manual Provisioning</Link>
        </nav>
        <div className="admin-secure"><ShieldCheck size={17} /><span><strong>MFA protected</strong><small>Founder actions audited</small></span></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="eyebrow">admin.bdb-os.com</p>
            <h1>{pageTitle}</h1>
            {tab === "clients" ? (
              <div className="admin-top-quiet-stats">
                <span><strong>{data.workspaces.length}</strong> clients</span>
                <span><strong>{data.workspaces.filter((item) => item.status === "active").length}</strong> active</span>
                <span><strong>{data.memberships.filter((item) => item.role === "owner" && item.status === "invited").length}</strong> owner invitations pending</span>
              </div>
            ) : null}
          </div>
          <div className="admin-top-actions">
            <button className="icon-button" onClick={() => void load()} aria-label="Refresh"><RefreshCw size={16} /></button>
            {tab === "clients" && <button className="button button-primary" onClick={() => setCreating(true)} disabled={!data.templates.some((template) => template.is_active)}><Plus size={16} /> New client</button>}
          </div>
        </header>

        {error && <div className="settings-note" style={{ marginBottom: 18 }}><strong>Action needed</strong><p>{error}</p></div>}
        {notice && <div className="toast"><Check size={17} /> {notice}</div>}

        {tab === "clients" && (
          <div className="admin-client-centered">
            <div className="admin-client-list">
              <div className="admin-client-list-header">Client businesses</div>
              {!data.workspaces.length && <p className="muted">No clients have been provisioned.</p>}
              {data.workspaces.map((workspace) => (
                <button key={workspace.id} className={workspace.id === activeWorkspace?.id ? "active" : ""} onClick={() => selectClient(workspace.id)}>
                  <span className="client-initial">{workspace.name.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{workspace.name}</strong><small>{data.plans.find((plan) => plan.id === workspace.plan_id)?.name ?? "Custom"} · {workspace.status}</small></span>
                </button>
              ))}
            </div>

            {activeWorkspace ? (
              <div className="admin-client-workspace">
                <div className="admin-client-identity">
                  <div>
                    <p className="eyebrow">{activeWorkspace.slug}.bdb-os.com</p>
                    <h2>{activeWorkspace.name}</h2>
                    <p className="muted">{activeWorkspace.legal_name || "Client workspace"}</p>
                  </div>
                  <div className="admin-client-status">
                    <label>Status</label>
                    <select value={activeWorkspace.status} onChange={(event) => void mutate({ action: "workspace-status", workspaceId: activeWorkspace.id, status: event.target.value }, "status", `Business marked ${event.target.value}.`)} disabled={busy === "status"}>
                      <option value="trial">Trial</option>
                      <option value="active">Active</option>
                      <option value="suspended">Suspended</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>

                <div className="admin-client-tabs" role="tablist" aria-label={`Manage ${activeWorkspace.name}`}>
                  {clientSections.map((section) => (
                    <button key={section.key} type="button" role="tab" aria-selected={clientSection === section.key} className={clientSection === section.key ? "active" : ""} onClick={() => setClientSection(section.key)}>{section.label}</button>
                  ))}
                </div>

                {clientSection === "overview" && (
                  <section>
                    <div className="admin-section-heading"><h3>Client overview</h3><p>Core commercial and workspace configuration for this business.</p></div>
                    <div className="admin-overview-grid">
                      <article className="admin-panel">
                        <h4>Workspace</h4>
                        <div className="admin-kv-list">
                          <div className="admin-kv-row"><span>Provisioning template</span><strong>{activeTemplate ? `${activeTemplate.name} · v${activeWorkspace.workspace_template_version ?? activeTemplate.version}` : "Legacy/custom"}</strong></div>
                          <div className="admin-kv-row"><span>Plan</span><select value={activeWorkspace.plan_id ?? ""} onChange={(event) => void mutate({ action: "workspace-plan", workspaceId: activeWorkspace.id, planId: event.target.value }, "plan", "Plan updated. Template provenance was retained.")}>{data.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
                        </div>
                      </article>

                      <article className="admin-panel">
                        <h4>Commercial</h4>
                        <div className="admin-kv-list">
                          <div className="admin-kv-row"><span>Subscription</span><strong>{subscription?.status ?? "Not started"}</strong></div>
                          <div className="admin-kv-row"><span>Monthly quote</span><strong>{contract?.monthly_amount ? `£${Number(contract.monthly_amount).toLocaleString()}` : "Custom quote"}</strong></div>
                          <div className="admin-kv-row"><span>Minimum term</span><strong>{contract ? `${contract.minimum_term_months} months` : "Not agreed"}</strong></div>
                        </div>
                      </article>

                      <article className="admin-panel">
                        <h4>Business relationship</h4>
                        <p>Connect only subsidiaries or sister companies that should appear together in the company switcher.</p>
                        <select className="admin-inline-input" value={activeGroupLink?.group_id ?? ""} onChange={(event) => event.target.value
                          ? void mutate({ action: "link-workspace", workspaceId: activeWorkspace.id, groupId: event.target.value }, "group-link", "Business linked to group.")
                          : void mutate({ action: "unlink-workspace", workspaceId: activeWorkspace.id }, "group-link", "Business removed from group.")} disabled={busy === "group-link"}>
                          <option value="">Independent business</option>
                          {data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                        </select>
                        {activeGroup ? <p>Currently connected to {activeGroup.name}.</p> : null}
                      </article>

                      <article className="admin-panel">
                        <h4>Custom branding</h4>
                        <div className="admin-kv-list">
                          <div className="admin-kv-row"><span>Company logo add-on</span><strong>{brandingEnabled ? "Enabled" : "Disabled"}</strong></div>
                        </div>
                        <div className="admin-form-actions"><button className="button button-secondary" onClick={() => setClientSection("branding")}><ImageIcon size={15} /> Manage branding</button></div>
                      </article>
                    </div>
                  </section>
                )}

                {clientSection === "access" && (
                  <section>
                    <div className="admin-section-heading"><h3>Access & Modules</h3><p>Client-specific module overrides. The original workspace template is not changed.</p></div>
                    <div className="admin-module-grid">
                      {data.features.filter((feature) => feature.key !== "custom_branding").map((feature) => {
                        const override = data.overrides.find((item) => item.workspace_id === activeWorkspace.id && item.feature_key === feature.key);
                        const planEnabled = data.planFeatures.some((item) => item.plan_id === activeWorkspace.plan_id && item.feature_key === feature.key && item.enabled);
                        const enabled = override?.enabled ?? planEnabled;
                        return (
                          <button key={feature.key} className={enabled ? "enabled" : ""} onClick={() => void mutate({ action: "feature-override", workspaceId: activeWorkspace.id, featureKey: feature.key, enabled: !enabled, reason: "Founder Admin client override" }, `feature-${feature.key}`, `${feature.name} ${!enabled ? "enabled" : "disabled"}.`)}>
                            <span>{enabled && <Check size={14} />}</span>
                            <div><strong>{feature.name}</strong><small>{override ? override.reason ?? "Client override" : planEnabled ? `${activePlan?.name} default` : "Not included"}</small></div>
                            {busy === `feature-${feature.key}` && <Loader2 className="spin" size={14} />}
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}

                {clientSection === "billing" && (
                  <section>
                    <div className="admin-section-heading"><h3>Billing</h3><p>Create a Stripe subscription checkout from the agreed commercial terms.</p></div>
                    <div className="admin-billing-layout">
                      <form className="admin-panel" onSubmit={createBillingLink}>
                        <h4>Create billing link</h4>
                        <div className="admin-form-grid">
                          <div className="field"><label>Monthly amount (GBP)</label><input type="number" min="1" step="0.01" value={billingAmount} onChange={(event) => setBillingAmount(event.target.value)} placeholder="199" required /></div>
                          <div className="field"><label>Minimum term</label><select value={billingTerm} onChange={(event) => setBillingTerm(event.target.value)}><option value="3">3 months</option><option value="6">6 months</option></select></div>
                          <div className="field"><label>Trial period</label><select value={billingTrial} onChange={(event) => setBillingTrial(event.target.value)}><option value="0">No trial</option><option value="7">7 days</option><option value="14">14 days</option><option value="30">30 days</option></select></div>
                        </div>
                        <div className="admin-form-actions"><button className="button button-primary" disabled={busy === "billing"}><CreditCard size={15} /> {busy === "billing" ? "Creating…" : "Create billing link"}</button></div>
                      </form>

                      <article className="admin-panel">
                        <h4>Current commercial record</h4>
                        <div className="admin-kv-list">
                          <div className="admin-kv-row"><span>Plan</span><strong>{activePlan?.name ?? "Custom"}</strong></div>
                          <div className="admin-kv-row"><span>Subscription</span><strong>{subscription?.status ?? "Not started"}</strong></div>
                          <div className="admin-kv-row"><span>Contract status</span><strong>{contract?.status ?? "Not created"}</strong></div>
                          <div className="admin-kv-row"><span>Monthly amount</span><strong>{contract?.monthly_amount ? `£${Number(contract.monthly_amount).toLocaleString()}` : "Not agreed"}</strong></div>
                          <div className="admin-kv-row"><span>Minimum term</span><strong>{contract ? `${contract.minimum_term_months} months` : "Not agreed"}</strong></div>
                        </div>
                      </article>
                    </div>
                  </section>
                )}

                {clientSection === "branding" && (
                  <section>
                    <div className="admin-section-heading"><h3>Branding</h3><p>Founder-controlled paid company identity. This is not full white-labelling.</p></div>
                    <div className="admin-branding-layout">
                      <article className="admin-panel">
                        <h4>Company logo</h4>
                        <p>The saved logo appears beside the client business name only when the add-on is enabled.</p>
                        <div className="admin-brand-preview">
                          {busy === "load-branding" ? <Loader2 className="spin" /> : branding?.logoUrl ? <Image src={branding.logoUrl} alt={`${activeWorkspace.name} logo`} width={260} height={118} unoptimized /> : <span className="admin-brand-placeholder"><ImageIcon size={27} /> No logo saved</span>}
                        </div>
                        <div className="admin-brand-actions">
                          <label className="button button-secondary admin-file-button">{busy === "upload-logo" ? <Loader2 className="spin" size={15} /> : <ImageUp size={15} />}{branding?.logoPath ? "Replace logo" : "Upload logo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadLogo(event.target.files?.[0])} disabled={busy === "upload-logo"} /></label>
                          {branding?.logoPath ? <button className="button button-danger" onClick={() => void removeLogo()} disabled={busy === "remove-logo"}><Trash2 size={15} /> {busy === "remove-logo" ? "Removing…" : "Remove"}</button> : null}
                        </div>
                        <p>PNG, JPG or WebP · maximum 2 MB.</p>
                      </article>

                      <article className="admin-panel">
                        <h4>Paid add-on control</h4>
                        {!brandingFeature ? <div className="settings-note"><strong>Branding entitlement unavailable</strong><p>The Custom Business Branding feature is not configured in this environment.</p></div> : (
                          <div className="admin-entitlement-row">
                            <span><strong>Display company logo</strong><small>{brandingEnabled ? "Visible in the client workspace." : "Standard BDB OS identity is shown."}</small></span>
                            <button className={`button ${brandingEnabled ? "button-secondary" : "button-primary"}`} onClick={() => void mutate({ action: "feature-override", workspaceId: activeWorkspace.id, featureKey: "custom_branding", enabled: !brandingEnabled, reason: "Founder Admin custom branding add-on" }, "branding-toggle", !brandingEnabled ? "Custom Business Branding enabled." : "Custom Business Branding disabled. The saved logo was retained.")} disabled={busy === "branding-toggle"}>{busy === "branding-toggle" ? <Loader2 className="spin" size={15} /> : brandingEnabled ? "Disable" : "Enable"}</button>
                          </div>
                        )}
                        <p style={{ marginTop: 16 }}>Disabling keeps the uploaded logo privately stored so it can be re-enabled later. Remove permanently deletes the saved asset.</p>
                      </article>
                    </div>
                  </section>
                )}

                {clientSection === "owner" && (
                  <section>
                    <div className="admin-section-heading"><h3>Owner & Access</h3><p>Client ownership and audited Founder administrative activity.</p></div>
                    <div className="admin-owner-layout">
                      <article className="admin-panel">
                        <h4>Business Owner</h4>
                        <div className="admin-owner-card">
                          <span><strong>{owner ? owner.profiles?.full_name || owner.email : "No owner membership found"}</strong><small>{owner ? `${owner.email} · ${owner.status}` : "Create or provision an owner before client handover."}</small>{owner?.invitation_expires_at && owner.status === "invited" ? <small>Invitation expires {new Date(owner.invitation_expires_at).toLocaleString()}</small> : null}</span>
                          {owner?.status === "invited" ? <button className="button button-secondary" onClick={() => void mutate({ action: "resend-owner-invite", workspaceId: activeWorkspace.id }, "resend-owner", "Owner invitation resent for seven days.")} disabled={busy === "resend-owner"}><MailCheck size={15} /> {busy === "resend-owner" ? "Sending…" : "Resend invitation"}</button> : null}
                        </div>
                      </article>

                      <article className="admin-panel">
                        <h4>Administrative audit reason</h4>
                        <p>Record why Founder-level administrative attention is required. This creates an audit entry; it does not grant a separate support session.</p>
                        <div className="admin-audit-note" style={{ marginTop: 13 }}>
                          <textarea value={supportReason} onChange={(event) => setSupportReason(event.target.value)} placeholder="Reason for administrative intervention…" />
                          <button className="button button-secondary" onClick={() => void recordAdministrativeReason()} disabled={!supportReason.trim() || busy === "support"}><ShieldCheck size={15} /> {busy === "support" ? "Recording…" : "Record reason"}</button>
                        </div>
                      </article>
                    </div>
                  </section>
                )}
              </div>
            ) : null}
          </div>
        )}

        {tab === "groups" && (
          <div className="settings-layout" style={{ alignItems: "start" }}>
            <div className="admin-detail">
              <h2>Create Business Group</h2>
              <p className="muted">Use groups only for subsidiaries, sister companies or entities that should be intentionally switchable.</p>
              <form onSubmit={createGroup}>
                <div className="field"><label>Group name</label><input name="name" required minLength={2} placeholder="GM Group" /></div>
                <div className="field" style={{ marginTop: 12 }}><label>Group slug</label><input name="slug" required pattern="[a-z0-9-]+" placeholder="gm-group" /></div>
                <button className="button button-primary" style={{ marginTop: 16 }} disabled={busy === "create-group"}><Plus size={16} /> {busy === "create-group" ? "Creating…" : "Create group"}</button>
              </form>
            </div>
            <div className="admin-detail">
              <h2>Approved connections</h2>
              {!data.groups.length && <p className="muted">No Business Groups have been created.</p>}
              {data.groups.map((group) => {
                const linked = data.groupLinks.filter((link) => link.group_id === group.id).map((link) => data.workspaces.find((workspace) => workspace.id === link.workspace_id)).filter(Boolean) as Workspace[];
                return (
                  <article key={group.id} style={{ padding: 16, border: "1px solid var(--border)", borderRadius: 14, marginTop: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span><strong>{group.name}</strong><small style={{ display: "block" }}>{group.slug}</small></span><span className="badge badge-gold">{linked.length} companies</span></div>
                    <div style={{ marginTop: 12 }}>{linked.length ? linked.map((workspace) => <div key={workspace.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}><span><Link2 size={14} /> {workspace.name}</span><button className="button button-quiet" onClick={() => void mutate({ action: "unlink-workspace", workspaceId: workspace.id }, `unlink-${workspace.id}`, `${workspace.name} removed from ${group.name}.`)}><Unlink size={14} /> Remove</button></div>) : <p className="muted small">No companies linked yet. Link one from its Client overview.</p>}</div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {tab === "plans" && (
          <div className="admin-plan-grid">
            {data.plans.map((plan) => (
              <article key={plan.id}><p className="eyebrow">Commercial plan</p><h2>{plan.name}</h2><p>{plan.description}</p><div className="plan-feature-list">
                {data.features.filter((feature) => feature.key !== "custom_branding").map((feature) => {
                  const enabled = data.planFeatures.some((item) => item.plan_id === plan.id && item.feature_key === feature.key && item.enabled);
                  return <button key={feature.key} className={enabled ? "enabled" : ""} onClick={() => void mutate({ action: "plan-feature", planId: plan.id, featureKey: feature.key, enabled: !enabled }, `plan-${plan.id}-${feature.key}`, `${plan.name} updated.`)}><span>{enabled && <Check size={13} />}</span>{feature.name}</button>;
                })}
              </div></article>
            ))}
          </div>
        )}

        {tab === "audit" && (
          <div className="audit-table">
            <div className="audit-row audit-head"><span>Action</span><span>Workspace</span><span>Time</span></div>
            {!data.audit.length && <p className="muted">No founder actions have been recorded.</p>}
            {data.audit.map((item) => <div className="audit-row" key={item.id}><span><Settings2 size={15} /><strong>{item.action}</strong></span><span>{data.workspaces.find((workspace) => workspace.id === item.workspace_id)?.name ?? "Platform"}</span><span>{new Date(item.created_at).toLocaleString()}</span></div>)}
          </div>
        )}
      </section>

      {creating && <CreateWorkspace templates={data.templates.filter((template) => template.is_active)} plans={data.plans} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); setNotice("Client business created from its workspace template and owner invitation sent."); await load(); }} onError={setError} />}
    </main>
  );
}

function CreateWorkspace({
  templates,
  plans,
  onClose,
  onCreated,
  onError,
}: {
  templates: WorkspaceTemplate[];
  plans: Plan[];
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const defaultTemplate = templates.find((template) => template.is_default) ?? templates[0];
  const [loading, setLoading] = useState(false);
  const [templateId, setTemplateId] = useState(defaultTemplate?.id ?? "");
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? defaultTemplate;
  const selectedPlan = plans.find((plan) => plan.id === selectedTemplate?.plan_id);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    onError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "create-workspace",
        name: form.get("name"),
        legalName: form.get("legalName"),
        slug: form.get("slug"),
        ownerName: form.get("ownerName"),
        ownerEmail: form.get("email"),
        templateId,
      }),
    });
    const result = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) { onError(result.error ?? "The client could not be created."); return; }
    await onCreated();
  }

  return (
    <div className="dialog-backdrop">
      <div className="dialog" style={{ maxWidth: 760 }}>
        <div className="dialog-header"><div><p className="eyebrow">Founder provisioning</p><h2>Create client business</h2><p className="muted">Creates an isolated workspace, copies one approved template and sends a seven-day activation invitation to its first Business Owner.</p></div><button className="icon-button" onClick={onClose} aria-label="Close">×</button></div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field"><label>Business name</label><input name="name" required minLength={2} /></div>
            <div className="field"><label>Legal name (optional)</label><input name="legalName" /></div>
            <div className="field"><label>Workspace slug</label><input name="slug" required pattern="[a-z0-9-]+" /></div>
            <div className="field"><label>Workspace template</label><select value={templateId} onChange={(event) => setTemplateId(event.target.value)} required>{templates.map((template) => <option key={template.id} value={template.id}>{template.name} · v{template.version}</option>)}</select></div>
            <div className="field"><label>Owner full name</label><input name="ownerName" required minLength={2} autoComplete="name" /></div>
            <div className="field"><label>Owner email</label><input name="email" type="email" required autoComplete="email" /></div>
          </div>
          <div className="settings-note" style={{ marginTop: 18 }}>
            <ShieldCheck size={20} />
            <strong>{selectedTemplate?.name ?? "No active template"}</strong>
            <p>{selectedTemplate?.description || "The template controls the starting plan, modules, settings, appearance and team access presets."}</p>
            <small>Commercial plan: {selectedPlan?.name ?? "Not configured"}</small>
          </div>
          <div className="dialog-actions" style={{ marginTop: 22 }}><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading || !templateId}><Building2 size={16} /> {loading ? "Creating securely…" : "Create workspace"}</button></div>
        </form>
      </div>
    </div>
  );
}
