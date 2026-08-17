"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Building2, Check, ImageIcon, ImageUp, Loader2, RefreshCw, ShieldCheck, Trash2 } from "lucide-react";
import { BdbMonogram } from "@/components/brand";
import styles from "./branding.module.css";

type Workspace = { id: string; name: string; slug: string; status: string; plan_id: string | null };
type Feature = { key: string; name: string };
type PlanFeature = { plan_id: string; feature_key: string; enabled: boolean };
type Override = { workspace_id: string; feature_key: string; enabled: boolean; reason: string | null };
type Dashboard = { workspaces: Workspace[]; features: Feature[]; planFeatures: PlanFeature[]; overrides: Override[] };
type BrandingState = { workspaceId: string; workspaceName: string; logoPath: string | null; logoUrl: string | null; updatedAt: string | null };

export default function CustomBrandingPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [selected, setSelected] = useState("");
  const [branding, setBranding] = useState<BrandingState | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDashboard = useCallback(async () => {
    setError("");
    const response = await fetch("/api/admin", { cache: "no-store" });
    if (response.status === 428) { router.push("/mfa"); return; }
    if (response.status === 401) { router.push("/login?next=/admin/branding"); return; }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setError(result.error ?? "Founder Admin could not be loaded."); return; }
    const dashboard = result as Dashboard;
    setData(dashboard);
    setSelected((current) => current && dashboard.workspaces.some((workspace) => workspace.id === current) ? current : dashboard.workspaces[0]?.id ?? "");
  }, [router]);

  const loadBranding = useCallback(async (id: string) => {
    if (!id) return;
    setBusy("load-branding");
    setError("");
    const response = await fetch(`/api/admin/branding?workspaceId=${encodeURIComponent(id)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setBranding(null); setError(result.error ?? "Branding could not be loaded."); return; }
    setBranding(result as BrandingState);
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void loadDashboard(), 0); return () => window.clearTimeout(timer); }, [loadDashboard]);
  useEffect(() => { if (selected) void loadBranding(selected); }, [selected, loadBranding]);

  const workspace = useMemo(() => data?.workspaces.find((item) => item.id === selected) ?? null, [data, selected]);
  const brandingFeature = data?.features.find((feature) => feature.key === "custom_branding") ?? null;
  const override = data?.overrides.find((item) => item.workspace_id === selected && item.feature_key === "custom_branding");
  const planEnabled = Boolean(data?.planFeatures.some((item) => item.plan_id === workspace?.plan_id && item.feature_key === "custom_branding" && item.enabled));
  const enabled = override?.enabled ?? planEnabled;

  async function toggleBranding() {
    if (!workspace || !brandingFeature) return;
    setBusy("toggle"); setError(""); setNotice("");
    const response = await fetch("/api/admin", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "feature-override", workspaceId: workspace.id, featureKey: "custom_branding", enabled: !enabled, reason: "Founder Admin custom branding add-on" }) });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setError(result.error ?? "Custom branding could not be changed."); return; }
    setNotice(!enabled ? "Custom Business Branding enabled." : "Custom Business Branding disabled. The saved logo was retained.");
    await loadDashboard();
  }

  async function upload(file?: File) {
    if (!file || !workspace) return;
    setBusy("upload"); setError(""); setNotice("");
    const form = new FormData(); form.set("workspaceId", workspace.id); form.set("file", file);
    const response = await fetch("/api/admin/branding", { method: "POST", body: form });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setError(result.error ?? "The company logo could not be uploaded."); return; }
    setNotice("Company logo saved. Enable Custom Business Branding when it should appear to the client.");
    await loadBranding(workspace.id);
  }

  async function removeLogo() {
    if (!workspace || !branding?.logoPath) return;
    if (!window.confirm(`Remove the saved logo for ${workspace.name}?`)) return;
    setBusy("remove"); setError(""); setNotice("");
    const response = await fetch("/api/admin/branding", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId: workspace.id }) });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setError(result.error ?? "The saved logo could not be removed."); return; }
    setNotice("Company logo removed.");
    await loadBranding(workspace.id);
  }

  if (!data && !error) return <main className="admin-loading"><Loader2 className="spin" /> Loading secure branding controls…</main>;

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <BdbMonogram />
        <p className="admin-label">Founder control plane</p>
        <nav><Link href="/admin"><ArrowLeft size={18} /> Founder Admin</Link><Link href="/admin/branding" className="active"><ImageIcon size={18} /> Custom branding</Link></nav>
        <div className="admin-secure"><ShieldCheck size={17} /><span><strong>MFA protected</strong><small>Founder actions audited</small></span></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div><p className="eyebrow">Commercial workspace add-on</p><h1>Custom Business Branding</h1><p className="muted">Control which clients may display their company logo inside BDB OS.</p></div>
          <button className="icon-button" onClick={() => void loadDashboard()} aria-label="Refresh"><RefreshCw size={16} /></button>
        </header>

        {error ? <div className="settings-note" style={{ marginBottom: 18 }}><strong>Action needed</strong><p>{error}</p></div> : null}
        {notice ? <div className="toast"><Check size={17} /> {notice}</div> : null}

        {!data?.workspaces.length ? (
          <div className="admin-detail"><Building2 size={22} /><h2>No client businesses yet</h2><p className="muted">Create a client before assigning custom branding.</p></div>
        ) : (
          <div className={styles.layout}>
            <aside className={styles.clientList}>
              <div className={styles.clientListHeader}><strong>Client businesses</strong><small>Choose the business to brand.</small></div>
              {data.workspaces.map((item) => <button type="button" key={item.id} className={item.id === selected ? styles.active : ""} onClick={() => setSelected(item.id)}><span className={styles.initials}>{item.name.slice(0, 2).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.status}</small></span></button>)}
            </aside>

            {workspace ? (
              <section className={styles.detail}>
                <header className={styles.detailHeader}><div><h2>{workspace.name}</h2><p>{workspace.slug} · company logo add-on</p></div><span className={`${styles.status} ${enabled ? styles.enabled : ""}`}>{enabled ? "Enabled" : "Disabled"}</span></header>

                {!brandingFeature ? <div className="settings-note" style={{ marginTop: 22 }}><strong>Migration required</strong><p>The Custom Business Branding entitlement is not available in this database yet.</p></div> : (
                  <div className={styles.grid}>
                    <div className={styles.panel}>
                      <h3>Company logo</h3><p>Upload the asset BDB OS will show beside the client’s business identity when the add-on is enabled.</p>
                      <div className={styles.preview}>{busy === "load-branding" ? <Loader2 className="spin" /> : branding?.logoUrl ? <Image src={branding.logoUrl} alt={`${workspace.name} logo`} width={260} height={126} unoptimized /> : <span className={styles.placeholder}><ImageIcon size={26} /> No logo saved</span>}</div>
                      <div className={styles.actions}>
                        <label className={`button button-secondary ${styles.fileButton}`}>{busy === "upload" ? <Loader2 className="spin" size={16} /> : <ImageUp size={16} />}{branding?.logoPath ? "Replace logo" : "Upload logo"}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void upload(event.target.files?.[0])} disabled={busy === "upload"} /></label>
                        {branding?.logoPath ? <button className="button button-danger" onClick={() => void removeLogo()} disabled={busy === "remove"}><Trash2 size={15} /> {busy === "remove" ? "Removing…" : "Remove"}</button> : null}
                      </div>
                      <p className={styles.note}>PNG, JPG or WebP · maximum 2 MB. Replacing a logo removes the previous stored file.</p>
                    </div>

                    <div className={styles.panel}>
                      <h3>Add-on control</h3><p>Only Founder Admin can turn this commercial option on or off.</p>
                      <div className={styles.toggleRow}><span><strong>Display company logo</strong><small>{enabled ? "Visible in the client workspace." : "Standard BDB OS identity is shown."}</small></span><button className={`button ${enabled ? "button-secondary" : "button-primary"} ${styles.switch}`} onClick={() => void toggleBranding()} disabled={busy === "toggle" || !brandingFeature}>{busy === "toggle" ? <Loader2 className="spin" size={15} /> : enabled ? "Disable" : "Enable"}</button></div>
                      <div className={styles.note}><strong>Commercial behaviour</strong><br />Disabling the add-on keeps the saved logo privately stored so it can be re-enabled later. Remove deletes the asset. BDB OS branding remains part of the product; this is not full white-labelling.</div>
                    </div>
                  </div>
                )}
              </section>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
