"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Check, Copy, KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { BdbMonogram } from "@/components/brand";

type Plan = { id: string; name: string; description: string; is_active: boolean };
type Feature = { key: string; name: string; description: string };
type Entitlement = { plan_id: string; feature_key: string; enabled: boolean };
type Dashboard = { plans: Plan[]; features: Feature[]; planFeatures: Entitlement[] };
type ProvisionedAccount = {
  workspaceId: string;
  loginId: string;
  accountStatus: string;
  activationMethod: string;
  emailSent: boolean;
  mustChangePassword: boolean;
};

export default function ManualProvisioningPage() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [planId, setPlanId] = useState("");
  const [selectedFeatures, setSelectedFeatures] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<ProvisionedAccount | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/admin", { cache: "no-store" });
      if (response.status === 428) { window.location.href = "/mfa"; return; }
      if (response.status === 401) { window.location.href = "/login?next=/admin/manual-provisioning"; return; }
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(payload.error ?? "Founder Admin could not be loaded.");
        return;
      }
      const dashboard = payload as Dashboard;
      const firstPlan = dashboard.plans.find((plan) => plan.is_active) ?? dashboard.plans[0];
      setData(dashboard);
      setPlanId(firstPlan?.id ?? "");
      setSelectedFeatures(new Set(
        dashboard.planFeatures
          .filter((item) => item.plan_id === firstPlan?.id && item.enabled)
          .map((item) => item.feature_key),
      ));
    })();
  }, []);

  const activePlans = useMemo(() => data?.plans.filter((plan) => plan.is_active) ?? [], [data]);

  function selectPlan(nextPlanId: string) {
    setPlanId(nextPlanId);
    setSelectedFeatures(new Set(
      data?.planFeatures
        .filter((item) => item.plan_id === nextPlanId && item.enabled)
        .map((item) => item.feature_key) ?? [],
    ));
  }

  async function copy(label: string, value: string) {
    await navigator.clipboard.writeText(value);
    setCopied(label);
    window.setTimeout(() => setCopied(""), 1600);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setResult(null);
    const form = new FormData(event.currentTarget);
    const password = String(form.get("temporaryPassword") ?? "");
    const response = await fetch("/api/admin/manual-workspace", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        legalName: form.get("legalName"),
        slug: form.get("slug"),
        ownerName: form.get("ownerName"),
        loginId: form.get("loginId"),
        temporaryPassword: password,
        planId,
        features: [...selectedFeatures],
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(payload.error ?? "The workspace could not be provisioned.");
      return;
    }
    setTemporaryPassword(password);
    setResult(payload as ProvisionedAccount);
    event.currentTarget.reset();
  }

  if (!data && !error) {
    return <main className="admin-loading"><Loader2 className="spin" /> Loading secure provisioning…</main>;
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <BdbMonogram />
        <p className="admin-label">Founder control plane</p>
        <nav>
          <Link href="/admin"><ArrowLeft size={18} /> Founder Admin</Link>
        </nav>
        <div className="admin-secure"><ShieldCheck size={17} /><span><strong>MFA protected</strong><small>Founder actions audited</small></span></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="eyebrow">Pilot account provisioning</p>
            <h1>Create an active workspace manually</h1>
            <p className="muted">Creates a confirmed owner account without sending or requiring a real owner email.</p>
          </div>
        </header>

        {error && <div className="settings-note" style={{ marginBottom: 18 }}><strong>Action needed</strong><p>{error}</p></div>}

        {result ? (
          <section className="admin-detail" style={{ maxWidth: 760 }}>
            <div className="support-access">
              <Check size={22} />
              <div><strong>Workspace and owner activated</strong><p>No invitation email was created or sent.</p></div>
            </div>
            <div className="admin-detail-grid" style={{ marginTop: 18 }}>
              <div><small>Account status</small><strong>{result.accountStatus}</strong></div>
              <div><small>Activation method</small><strong>{result.activationMethod}</strong></div>
              <div><small>Email sent</small><strong>{result.emailSent ? "Yes" : "No"}</strong></div>
              <div><small>Password change</small><strong>{result.mustChangePassword ? "Required" : "Not required"}</strong></div>
            </div>
            <div className="billing-action" style={{ marginTop: 18 }}>
              <div><strong>Login ID</strong><p>{result.loginId}</p></div>
              <button className="button button-secondary" onClick={() => void copy("login", result.loginId)}><Copy size={15} /> {copied === "login" ? "Copied" : "Copy"}</button>
            </div>
            <div className="billing-action">
              <div><strong>Temporary password</strong><p>{temporaryPassword}</p><small>This value is shown only in this browser result and is not stored by BDB OS.</small></div>
              <button className="button button-secondary" onClick={() => void copy("password", temporaryPassword)}><Copy size={15} /> {copied === "password" ? "Copied" : "Copy"}</button>
            </div>
            <div className="dialog-actions" style={{ marginTop: 20 }}>
              <Link className="button button-secondary" href="/admin">Return to Founder Admin</Link>
              <button className="button button-primary" onClick={() => { setResult(null); setTemporaryPassword(""); }}><Building2 size={16} /> Create another</button>
            </div>
          </section>
        ) : data ? (
          <form className="admin-detail" style={{ maxWidth: 840 }} onSubmit={submit}>
            <div className="support-access">
              <KeyRound size={22} />
              <div><strong>Manual activation</strong><p>The owner signs in with an internal BDB login ID and temporary password. Password recovery by email remains unavailable.</p></div>
            </div>

            <div className="form-grid" style={{ marginTop: 22 }}>
              <div className="field"><label>Business name</label><input name="name" required minLength={2} /></div>
              <div className="field"><label>Legal name (optional)</label><input name="legalName" /></div>
              <div className="field"><label>Workspace slug</label><input name="slug" required minLength={3} pattern="[a-z0-9-]+" placeholder="vanita-spa" /></div>
              <div className="field"><label>Starting plan</label><select value={planId} onChange={(event) => selectPlan(event.target.value)} required>{activePlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
              <div className="field"><label>Owner full name</label><input name="ownerName" required minLength={2} autoComplete="name" /></div>
              <div className="field"><label>Owner login ID</label><input name="loginId" required minLength={3} pattern="[A-Za-z0-9._-]+" placeholder="giovanni" autoComplete="username" /><small>No real email address is required.</small></div>
              <div className="field"><label>Temporary password</label><input name="temporaryPassword" type="password" required minLength={12} autoComplete="new-password" /><small>At least 12 characters with uppercase, lowercase and a number.</small></div>
            </div>

            <h3 style={{ marginTop: 24 }}>Enabled modules</h3>
            <p className="muted small">These choices create the same workspace overrides used by normal Founder Admin provisioning.</p>
            <div className="entitlement-grid" style={{ marginTop: 12 }}>
              {data.features.map((feature) => {
                const enabled = selectedFeatures.has(feature.key);
                return (
                  <button type="button" key={feature.key} className={enabled ? "enabled" : ""} onClick={() => setSelectedFeatures((current) => {
                    const next = new Set(current);
                    if (next.has(feature.key)) next.delete(feature.key); else next.add(feature.key);
                    return next;
                  })}>
                    <span>{enabled && <Check size={14} />}</span>
                    <div><strong>{feature.name}</strong><small>{feature.description}</small></div>
                  </button>
                );
              })}
            </div>

            <div className="dialog-actions" style={{ marginTop: 24 }}>
              <Link className="button button-secondary" href="/admin">Cancel</Link>
              <button className="button button-primary" disabled={loading || !planId}><Building2 size={16} /> {loading ? "Provisioning securely…" : "Create and activate owner"}</button>
            </div>
          </form>
        ) : null}
      </section>
    </main>
  );
}
