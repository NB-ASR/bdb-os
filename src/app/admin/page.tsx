"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  Building2,
  Check,
  CreditCard,
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
  Unlink,
  UsersRound,
} from "lucide-react";
import { BdbMonogram } from "@/components/brand";

type Plan = { id: string; code: string; name: string; description: string; is_active: boolean };
type Feature = { key: string; name: string; description: string; category: string; route: string | null };
type Workspace = { id: string; name: string; legal_name: string | null; slug: string; status: string; plan_id: string | null; created_at: string };
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
  subscriptions: Subscription[];
  contracts: Contract[];
  memberships: Membership[];
  groups: Group[];
  groupLinks: GroupLink[];
  audit: Audit[];
};
type Tab = "clients" | "groups" | "plans" | "audit";

export default function AdminPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<Tab>("clients");
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setError("");
    const response = await fetch("/api/admin", { cache: "no-store" });
    if (response.status === 428) { window.location.href = "/mfa"; return; }
    if (response.status === 401) { window.location.href = "/login?next=/admin"; return; }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error === "NOT_CONFIGURED" ? "Founder Admin is not connected to Supabase in this environment." : result.error ?? "Founder Admin could not be loaded.");
      return;
    }
    const dashboard = result as Dashboard;
    setData(dashboard);
    setSelected((current) => current && dashboard.workspaces.some((workspace) => workspace.id === current) ? current : dashboard.workspaces[0]?.id ?? null);
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

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

  async function createBillingLink(workspaceId: string) {
    const quote = window.prompt("Agreed monthly amount in GBP (for example 495):");
    if (!quote) return;
    const term = window.prompt("Minimum commitment in months: 3 or 6", "6");
    if (!term) return;
    const trial = window.prompt("Trial days: 0, 7, 14 or 30", "0");
    if (trial === null) return;
    setBusy("billing");
    const response = await fetch("/api/admin/billing-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, monthlyAmount: Number(quote), termMonths: Number(term), trialDays: Number(trial) }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (response.ok && result.url) window.open(result.url, "_blank", "noopener,noreferrer");
    else setError(result.error ?? "The billing link could not be created.");
  }

  const activeWorkspace = useMemo(
    () => data?.workspaces.find((workspace) => workspace.id === selected) ?? data?.workspaces[0] ?? null,
    [data, selected],
  );
  const activePlan = data?.plans.find((plan) => plan.id === activeWorkspace?.plan_id);
  const subscription = data?.subscriptions.find((item) => item.workspace_id === activeWorkspace?.id);
  const contract = data?.contracts.find((item) => item.workspace_id === activeWorkspace?.id);
  const owner = data?.memberships.find((membership) => membership.workspace_id === activeWorkspace?.id && membership.role === "owner");
  const activeGroupLink = data?.groupLinks.find((link) => link.workspace_id === activeWorkspace?.id);

  if (!data && !error) return <main className="admin-loading"><Loader2 className="spin" /> Loading secure control plane…</main>;
  if (!data) return (
    <main className="admin-loading" style={{ flexDirection: "column", gap: 14 }}>
      <ShieldCheck size={28} />
      <strong>Founder Admin unavailable</strong>
      <p>{error}</p>
      <button className="button button-secondary" onClick={() => void load()}><RefreshCw size={16} /> Retry</button>
    </main>
  );

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <BdbMonogram />
        <p className="admin-label">Founder control plane</p>
        <nav>
          <button className={tab === "clients" ? "active" : ""} onClick={() => setTab("clients")}><Building2 size={18} /> Clients</button>
          <button className={tab === "groups" ? "active" : ""} onClick={() => setTab("groups")}><Layers3 size={18} /> Business Groups</button>
          <button className={tab === "plans" ? "active" : ""} onClick={() => setTab("plans")}><SlidersHorizontal size={18} /> Plans & features</button>
          <button className={tab === "audit" ? "active" : ""} onClick={() => setTab("audit")}><Activity size={18} /> Audit trail</button>
        </nav>
        <div className="admin-secure"><ShieldCheck size={17} /><span><strong>MFA protected</strong><small>Founder actions audited</small></span></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="eyebrow">admin.bdb-os.com</p>
            <h1>{tab === "clients" ? "Client businesses" : tab === "groups" ? "Connected companies" : tab === "plans" ? "Plans & entitlements" : "Platform audit trail"}</h1>
          </div>
          <div className="admin-top-actions">
            <button className="icon-button" onClick={() => void load()} aria-label="Refresh"><RefreshCw size={16} /></button>
            {tab === "clients" && <button className="button button-primary" onClick={() => setCreating(true)}><Plus size={16} /> New client</button>}
          </div>
        </header>

        {error && <div className="settings-note" style={{ marginBottom: 18 }}><strong>Action needed</strong><p>{error}</p></div>}
        {notice && <div className="toast"><Check size={17} /> {notice}</div>}

        <div className="admin-stats">
          <div><span><Building2 size={17} /></span><small>Client businesses</small><strong>{data.workspaces.length}</strong></div>
          <div><span><UsersRound size={17} /></span><small>Active clients</small><strong>{data.workspaces.filter((item) => item.status === "active").length}</strong></div>
          <div><span><Layers3 size={17} /></span><small>Business groups</small><strong>{data.groups.length}</strong></div>
          <div><span><KeyRound size={17} /></span><small>Pending owners</small><strong>{data.memberships.filter((item) => item.role === "owner" && item.status === "invited").length}</strong></div>
        </div>

        {tab === "clients" && (
          <div className="admin-client-layout">
            <div className="admin-client-list">
              {!data.workspaces.length && <p className="muted">No clients have been provisioned.</p>}
              {data.workspaces.map((workspace) => (
                <button key={workspace.id} className={workspace.id === activeWorkspace?.id ? "active" : ""} onClick={() => setSelected(workspace.id)}>
                  <span className="client-initial">{workspace.name.slice(0, 2).toUpperCase()}</span>
                  <span><strong>{workspace.name}</strong><small>{data.plans.find((plan) => plan.id === workspace.plan_id)?.name ?? "Custom"} · {workspace.status}</small></span>
                </button>
              ))}
            </div>
            {activeWorkspace && (
              <div className="admin-detail">
                <div className="admin-detail-head">
                  <div><p className="eyebrow">{activeWorkspace.slug}.bdb-os.com</p><h2>{activeWorkspace.name}</h2>{activeWorkspace.legal_name && <p className="muted">{activeWorkspace.legal_name}</p>}</div>
                  <select value={activeWorkspace.status} onChange={(event) => void mutate({ action: "workspace-status", workspaceId: activeWorkspace.id, status: event.target.value }, "status", `Business marked ${event.target.value}.`)} disabled={busy === "status"}>
                    <option value="trial">Trial</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="cancelled">Cancelled</option>
                  </select>
                </div>

                <div className="admin-detail-grid">
                  <div><small>Plan</small><select value={activeWorkspace.plan_id ?? ""} onChange={(event) => void mutate({ action: "workspace-plan", workspaceId: activeWorkspace.id, planId: event.target.value }, "plan", "Plan updated.")}>{data.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
                  <div><small>Subscription</small><strong>{subscription?.status ?? "Not started"}</strong></div>
                  <div><small>Minimum term</small><strong>{contract ? `${contract.minimum_term_months} months` : "Not agreed"}</strong></div>
                  <div><small>Monthly quote</small><strong>{contract?.monthly_amount ? `£${Number(contract.monthly_amount).toLocaleString()}` : "Custom quote"}</strong></div>
                </div>

                <div className="billing-action">
                  <div><strong>Business Owner</strong><p>{owner ? `${owner.profiles?.full_name || owner.email} · ${owner.status}` : "No owner membership found"}</p>{owner?.invitation_expires_at && owner.status === "invited" && <small>Invitation expires {new Date(owner.invitation_expires_at).toLocaleString()}</small>}</div>
                  {owner?.status === "invited" && <button className="button button-secondary" onClick={() => void mutate({ action: "resend-owner-invite", workspaceId: activeWorkspace.id }, "resend-owner", "Owner invitation resent for seven days.")} disabled={busy === "resend-owner"}><MailCheck size={15} /> {busy === "resend-owner" ? "Sending…" : "Resend invitation"}</button>}
                </div>

                <div className="billing-action">
                  <div><strong>Business Group</strong><p>Only businesses deliberately connected here can appear together in the company switcher.</p></div>
                  <select
                    value={activeGroupLink?.group_id ?? ""}
                    onChange={(event) => event.target.value
                      ? void mutate({ action: "link-workspace", workspaceId: activeWorkspace.id, groupId: event.target.value }, "group-link", "Business linked to group.")
                      : void mutate({ action: "unlink-workspace", workspaceId: activeWorkspace.id }, "group-link", "Business removed from group.")}
                    disabled={busy === "group-link"}
                  >
                    <option value="">Independent business</option>
                    {data.groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </div>

                <div className="billing-action">
                  <div><strong>Custom subscription</strong><p>Create a Stripe checkout link from the agreed quote, trial and minimum term.</p></div>
                  <button className="button button-secondary" onClick={() => void createBillingLink(activeWorkspace.id)} disabled={busy === "billing"}><CreditCard size={15} /> {busy === "billing" ? "Creating…" : "Create billing link"}</button>
                </div>

                <h3>Client modules</h3>
                <p className="muted small">Overrides take priority over the {activePlan?.name ?? "selected"} plan and are enforced in the database.</p>
                <div className="entitlement-grid">
                  {data.features.map((feature) => {
                    const override = data.overrides.find((item) => item.workspace_id === activeWorkspace.id && item.feature_key === feature.key);
                    const planEnabled = data.planFeatures.some((item) => item.plan_id === activeWorkspace.plan_id && item.feature_key === feature.key && item.enabled);
                    const enabled = override?.enabled ?? planEnabled;
                    return (
                      <button key={feature.key} className={enabled ? "enabled" : ""} onClick={() => void mutate({ action: "feature-override", workspaceId: activeWorkspace.id, featureKey: feature.key, enabled: !enabled, reason: "Founder Admin override" }, `feature-${feature.key}`, `${feature.name} ${!enabled ? "enabled" : "disabled"}.`)}>
                        <span>{enabled && <Check size={14} />}</span><div><strong>{feature.name}</strong><small>{override ? "Client override" : planEnabled ? `${activePlan?.name} default` : "Not included"}</small></div>{busy === `feature-${feature.key}` && <Loader2 className="spin" size={14} />}
                      </button>
                    );
                  })}
                </div>

                <div className="support-access">
                  <ShieldCheck size={20} /><div><strong>Audited support access</strong><p>Any founder support access must record the workspace, founder, reason and time.</p></div>
                  <button className="button button-secondary" onClick={() => { const reason = window.prompt("Why do you need support access to this workspace?"); if (reason) void mutate({ action: "support-access", workspaceId: activeWorkspace.id, reason }, "support", "Support reason recorded."); }}>Record reason</button>
                </div>
              </div>
            )}
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
                    <div style={{ marginTop: 12 }}>{linked.length ? linked.map((workspace) => <div key={workspace.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0" }}><span><Link2 size={14} /> {workspace.name}</span><button className="button button-quiet" onClick={() => void mutate({ action: "unlink-workspace", workspaceId: workspace.id }, `unlink-${workspace.id}`, `${workspace.name} removed from ${group.name}.`)}><Unlink size={14} /> Remove</button></div>) : <p className="muted small">No companies linked yet. Link one from its Client detail page.</p>}</div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {tab === "plans" && (
          <div className="admin-plan-grid">
            {data.plans.map((plan) => (
              <article key={plan.id}><p className="eyebrow">Custom quote</p><h2>{plan.name}</h2><p>{plan.description}</p><div className="plan-feature-list">
                {data.features.map((feature) => {
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

      {creating && <CreateWorkspace plans={data.plans} features={data.features} planFeatures={data.planFeatures} onClose={() => setCreating(false)} onCreated={async () => { setCreating(false); setNotice("Client business created and owner invitation sent."); await load(); }} onError={setError} />}
    </main>
  );
}

function CreateWorkspace({
  plans,
  features,
  planFeatures,
  onClose,
  onCreated,
  onError,
}: {
  plans: Plan[];
  features: Feature[];
  planFeatures: Entitlement[];
  onClose: () => void;
  onCreated: () => Promise<void>;
  onError: (message: string) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(
    new Set(planFeatures.filter((item) => item.plan_id === plans[0]?.id && item.enabled).map((item) => item.feature_key)),
  );

  function selectPlan(nextPlanId: string) {
    setPlanId(nextPlanId);
    setSelectedFeatures(new Set(planFeatures.filter((item) => item.plan_id === nextPlanId && item.enabled).map((item) => item.feature_key)));
  }

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
        planId,
        features: [...selectedFeatures],
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
        <div className="dialog-header"><div><p className="eyebrow">Founder provisioning</p><h2>Create client business</h2><p className="muted">Creates an isolated workspace and sends a seven-day activation invitation to its first Business Owner.</p></div><button className="icon-button" onClick={onClose}>×</button></div>
        <form onSubmit={submit}>
          <div className="form-grid">
            <div className="field"><label>Business name</label><input name="name" required minLength={2} /></div>
            <div className="field"><label>Legal name (optional)</label><input name="legalName" /></div>
            <div className="field"><label>Workspace slug</label><input name="slug" required pattern="[a-z0-9-]+" /></div>
            <div className="field"><label>Starting plan</label><select value={planId} onChange={(event) => selectPlan(event.target.value)}>{plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
            <div className="field"><label>Owner full name</label><input name="ownerName" required minLength={2} autoComplete="name" /></div>
            <div className="field"><label>Owner email</label><input name="email" type="email" required autoComplete="email" /></div>
          </div>
          <h3 style={{ marginTop: 22 }}>Enabled modules</h3>
          <p className="muted small">These choices create real workspace overrides. They can be changed later from Founder Admin.</p>
          <div className="entitlement-grid" style={{ marginTop: 12 }}>
            {features.map((feature) => {
              const enabled = selectedFeatures.has(feature.key);
              return <button type="button" key={feature.key} className={enabled ? "enabled" : ""} onClick={() => setSelectedFeatures((current) => { const next = new Set(current); if (next.has(feature.key)) next.delete(feature.key); else next.add(feature.key); return next; })}><span>{enabled && <Check size={14} />}</span><div><strong>{feature.name}</strong><small>{feature.description}</small></div></button>;
            })}
          </div>
          <div className="dialog-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={loading}><Building2 size={16} /> {loading ? "Creating securely…" : "Create and invite owner"}</button></div>
        </form>
      </div>
    </div>
  );
}
