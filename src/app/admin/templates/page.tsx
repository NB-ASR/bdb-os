"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  CopyPlus,
  Layers3,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
} from "lucide-react";
import { BdbMonogram } from "@/components/brand";

const actionKeys = ["view", "create", "edit", "delete", "approve", "export"] as const;
type ActionKey = (typeof actionKeys)[number];
type ProfileKey = "manager" | "employee";
type Plan = { id: string; code: string; name: string; description: string };
type PlanFeature = { plan_id: string; feature_key: string; enabled: boolean };
type Feature = { key: string; name: string; description: string; category: string };
type Template = {
  id: string;
  code: string;
  name: string;
  description: string;
  plan_id: string;
  version: number;
  is_active: boolean;
  is_default: boolean;
  settings_defaults: Record<string, unknown>;
  theme_defaults: Record<string, unknown>;
  workspace_count: number;
};
type TemplateFeature = { template_id: string; feature_key: string; enabled: boolean };
type TemplatePermission = {
  template_id: string;
  access_profile: "manager" | "employee" | "custom";
  feature_key: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
  can_export: boolean;
};
type Dashboard = {
  templates: Template[];
  templateFeatures: TemplateFeature[];
  templatePermissions: TemplatePermission[];
  plans: Plan[];
  planFeatures: PlanFeature[];
  features: Feature[];
};
type PermissionDraft = Record<ProfileKey, Record<string, Record<ActionKey, boolean>>>;

function standardPermission(profile: ProfileKey, action: ActionKey) {
  if (profile === "manager") return ["view", "create", "edit", "approve", "export"].includes(action);
  return ["view", "create", "edit"].includes(action);
}

function emptyPermissionDraft(features: Feature[]): PermissionDraft {
  return {
    manager: Object.fromEntries(features.map((feature) => [
      feature.key,
      Object.fromEntries(actionKeys.map((action) => [action, standardPermission("manager", action)])),
    ])),
    employee: Object.fromEntries(features.map((feature) => [
      feature.key,
      Object.fromEntries(actionKeys.map((action) => [action, standardPermission("employee", action)])),
    ])),
  } as PermissionDraft;
}

function text(value: unknown, fallback: string) {
  return typeof value === "string" && value ? value : fallback;
}

function numberValue(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export default function WorkspaceTemplatesPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [planId, setPlanId] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [isDefault, setIsDefault] = useState(false);
  const [currency, setCurrency] = useState("GBP");
  const [invoicePrefix, setInvoicePrefix] = useState("BDB");
  const [vatRate, setVatRate] = useState(20);
  const [timezone, setTimezone] = useState("Europe/London");
  const [mode, setMode] = useState("dark");
  const [accentColor, setAccentColor] = useState("#d3a84b");
  const [density, setDensity] = useState("comfortable");
  const [textScale, setTextScale] = useState(1);
  const [featureDraft, setFeatureDraft] = useState<Record<string, boolean>>({});
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft>({ manager: {}, employee: {} });

  const load = useCallback(async (preferredId?: string | null) => {
    setLoading(true);
    setError("");
    const response = await fetch("/api/admin/templates", { cache: "no-store" });
    if (response.status === 428) { router.push("/mfa"); return; }
    if (response.status === 401) { router.push("/login?next=/admin/templates"); return; }
    const payload = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(payload.error ?? "Workspace templates could not be loaded.");
      return;
    }
    const dashboard = payload as Dashboard;
    setData(dashboard);
    setSelectedId((current) => {
      const candidate = preferredId ?? current;
      return candidate && dashboard.templates.some((template) => template.id === candidate)
        ? candidate
        : dashboard.templates[0]?.id ?? null;
    });
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  const selected = useMemo(
    () => data?.templates.find((template) => template.id === selectedId) ?? null,
    [data, selectedId],
  );

  const populateTemplate = useCallback((template: Template | null, dashboard: Dashboard) => {
    const firstPlan = dashboard.plans[0];
    const nextPlanId = template?.plan_id ?? firstPlan?.id ?? "";
    setCode(template?.code ?? "");
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
    setPlanId(nextPlanId);
    setIsActive(template?.is_active ?? true);
    setIsDefault(template?.is_default ?? false);
    setCurrency(text(template?.settings_defaults.currency, "GBP"));
    setInvoicePrefix(text(template?.settings_defaults.invoicePrefix, "BDB"));
    setVatRate(numberValue(template?.settings_defaults.vatRate, 20));
    setTimezone(text(template?.settings_defaults.timezone, "Europe/London"));
    setMode(text(template?.theme_defaults.mode, "dark"));
    setAccentColor(text(template?.theme_defaults.accentColor, "#d3a84b"));
    setDensity(text(template?.theme_defaults.density, "comfortable"));
    setTextScale(numberValue(template?.theme_defaults.textScale, 1));

    const planDefaults = Object.fromEntries(dashboard.features.map((feature) => [
      feature.key,
      dashboard.planFeatures.some((item) => item.plan_id === nextPlanId && item.feature_key === feature.key && item.enabled),
    ]));
    setFeatureDraft(template
      ? Object.fromEntries(dashboard.features.map((feature) => [
          feature.key,
          dashboard.templateFeatures.some((item) => item.template_id === template.id && item.feature_key === feature.key && item.enabled),
        ]))
      : planDefaults);

    const defaults = emptyPermissionDraft(dashboard.features);
    if (template) {
      for (const profile of ["manager", "employee"] as const) {
        for (const feature of dashboard.features) {
          const saved = dashboard.templatePermissions.find((item) =>
            item.template_id === template.id && item.access_profile === profile && item.feature_key === feature.key);
          if (!saved) continue;
          for (const action of actionKeys) {
            defaults[profile][feature.key][action] = Boolean(saved[`can_${action}`]);
          }
        }
      }
    }
    setPermissionDraft(defaults);
  }, []);

  useEffect(() => {
    if (!data) return;
    if (isNew) {
      populateTemplate(null, data);
      return;
    }
    if (selected) populateTemplate(selected, data);
  }, [data, selected, isNew, populateTemplate]);

  function startNew() {
    setIsNew(true);
    setSelectedId(null);
    setError("");
    setNotice("");
  }

  function selectTemplate(templateId: string) {
    setIsNew(false);
    setSelectedId(templateId);
    setError("");
    setNotice("");
  }

  function resetModulesToPlan(nextPlanId = planId) {
    if (!data) return;
    setFeatureDraft(Object.fromEntries(data.features.map((feature) => [
      feature.key,
      data.planFeatures.some((item) => item.plan_id === nextPlanId && item.feature_key === feature.key && item.enabled),
    ])));
  }

  async function save() {
    if (!data) return;
    setBusy(true);
    setError("");
    setNotice("");

    const permissions = data.features.flatMap((feature) => [
      ...(["manager", "employee"] as const).map((profile) => ({
        accessProfile: profile,
        featureKey: feature.key,
        ...Object.fromEntries(actionKeys.map((action) => [
          `can_${action}`,
          Boolean(permissionDraft[profile]?.[feature.key]?.[action]),
        ])),
      })),
      {
        accessProfile: "custom",
        featureKey: feature.key,
        can_view: false,
        can_create: false,
        can_edit: false,
        can_delete: false,
        can_approve: false,
        can_export: false,
      },
    ]);

    const response = await fetch("/api/admin/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        templateId: isNew ? null : selected?.id,
        code,
        name,
        description,
        planId,
        isActive,
        isDefault,
        settingsDefaults: { currency: currency.toUpperCase(), invoicePrefix, vatRate, timezone },
        themeDefaults: {
          preset: "obsidian-gold",
          mode,
          accentColor,
          fontFamily: "manrope",
          textScale,
          density,
          highContrast: booleanValue(selected?.theme_defaults.highContrast, false),
          reducedMotion: booleanValue(selected?.theme_defaults.reducedMotion, false),
        },
        features: data.features.map((feature) => ({ featureKey: feature.key, enabled: Boolean(featureDraft[feature.key]) })),
        permissions,
      }),
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);
    if (!response.ok) {
      setError(payload.error ?? "The workspace template could not be saved.");
      return;
    }
    setIsNew(false);
    setNotice(isNew ? "Workspace template created." : "Workspace template version created. Existing clients were not changed.");
    await load(String(payload.templateId ?? selected?.id ?? ""));
  }

  if (loading && !data) {
    return <main className="admin-loading"><Loader2 className="spin" /> Loading workspace templates…</main>;
  }

  return (
    <main className="admin-shell">
      <aside className="admin-sidebar">
        <BdbMonogram />
        <p className="admin-label">Founder control plane</p>
        <nav>
          <Link href="/admin"><ArrowLeft size={18} /> Founder Admin</Link>
          <button type="button" className="active"><Layers3 size={18} /> Workspace templates</button>
        </nav>
        <div className="admin-secure"><ShieldCheck size={17} /><span><strong>MFA protected</strong><small>Template changes audited</small></span></div>
      </aside>

      <section className="admin-main">
        <header className="admin-topbar">
          <div>
            <p className="eyebrow">Platform provisioning</p>
            <h1>Workspace templates</h1>
            <p className="muted">Versioned starting points for modules, business defaults, appearance and team access presets.</p>
          </div>
          <div className="admin-top-actions">
            <button className="button button-secondary" onClick={() => void load(selectedId)} disabled={loading}><RefreshCw size={16} /> Refresh</button>
            <button className="button button-primary" onClick={startNew}><CopyPlus size={16} /> New template</button>
          </div>
        </header>

        {error && <div className="settings-note" style={{ marginBottom: 18 }}><strong>Action needed</strong><p>{error}</p></div>}
        {notice && <div className="toast"><Check size={17} /> {notice}</div>}

        <div className="admin-client-layout">
          <div className="admin-client-list">
            {data?.templates.map((template) => (
              <button key={template.id} className={!isNew && template.id === selectedId ? "active" : ""} onClick={() => selectTemplate(template.id)}>
                <span className="client-initial">{template.name.slice(0, 2).toUpperCase()}</span>
                <span>
                  <strong>{template.name}</strong>
                  <small>v{template.version} · {template.workspace_count} workspaces{template.is_default ? " · default" : ""}</small>
                </span>
              </button>
            ))}
          </div>

          {data && (
            <div className="admin-detail">
              <div className="admin-detail-head">
                <div>
                  <p className="eyebrow">{isNew ? "New versioned template" : `Template version ${selected?.version ?? 1}`}</p>
                  <h2>{isNew ? "Create workspace template" : selected?.name}</h2>
                  {!isNew && <p className="muted">Saving creates a new template version. Existing workspaces keep their copied configuration.</p>}
                </div>
                <button className="button button-primary" onClick={() => void save()} disabled={busy || !code || !name || !planId}>
                  {busy ? <Loader2 className="spin" size={16} /> : <Save size={16} />}
                  {busy ? "Saving…" : "Save template"}
                </button>
              </div>

              <div className="form-grid">
                <div className="field"><label>Template name</label><input value={name} onChange={(event) => setName(event.target.value)} required minLength={2} /></div>
                <div className="field"><label>Template code</label><input value={code} onChange={(event) => setCode(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} required pattern="[a-z0-9-]+" /></div>
                <div className="field"><label>Starting plan</label><select value={planId} onChange={(event) => { setPlanId(event.target.value); resetModulesToPlan(event.target.value); }}>{data.plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}</option>)}</select></div>
                <div className="field"><label>Description</label><input value={description} onChange={(event) => setDescription(event.target.value)} /></div>
              </div>

              <div className="billing-action" style={{ marginTop: 18 }}>
                <label><input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} /> Active for new provisioning</label>
                <label><input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} /> Default template</label>
              </div>

              <h3 style={{ marginTop: 24 }}>Workspace defaults</h3>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="field"><label>Currency</label><input value={currency} maxLength={3} onChange={(event) => setCurrency(event.target.value.toUpperCase())} /></div>
                <div className="field"><label>Invoice prefix</label><input value={invoicePrefix} maxLength={12} onChange={(event) => setInvoicePrefix(event.target.value)} /></div>
                <div className="field"><label>VAT rate</label><input type="number" min={0} max={100} step="0.01" value={vatRate} onChange={(event) => setVatRate(Number(event.target.value))} /></div>
                <div className="field"><label>Timezone</label><input value={timezone} onChange={(event) => setTimezone(event.target.value)} /></div>
                <div className="field"><label>Appearance mode</label><select value={mode} onChange={(event) => setMode(event.target.value)}><option value="dark">Dark</option><option value="light">Light</option></select></div>
                <div className="field"><label>Accent colour</label><input type="color" value={accentColor} onChange={(event) => setAccentColor(event.target.value)} /></div>
                <div className="field"><label>Density</label><select value={density} onChange={(event) => setDensity(event.target.value)}><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></div>
                <div className="field"><label>Text scale</label><input type="number" min={0.8} max={1.4} step="0.05" value={textScale} onChange={(event) => setTextScale(Number(event.target.value))} /></div>
              </div>

              <div className="admin-detail-head" style={{ marginTop: 24 }}>
                <div><h3>Enabled modules</h3><p className="muted small">The selected plan is the commercial reference. This exact matrix is copied as workspace overrides.</p></div>
                <button className="button button-secondary" type="button" onClick={() => resetModulesToPlan()}>Reset to plan</button>
              </div>
              <div className="entitlement-grid">
                {data.features.map((feature) => {
                  const enabled = Boolean(featureDraft[feature.key]);
                  return (
                    <button type="button" key={feature.key} className={enabled ? "enabled" : ""} onClick={() => setFeatureDraft((current) => ({ ...current, [feature.key]: !enabled }))}>
                      <span>{enabled && <Check size={14} />}</span>
                      <div><strong>{feature.name}</strong><small>{feature.description}</small></div>
                    </button>
                  );
                })}
              </div>

              {(["manager", "employee"] as const).map((profile) => (
                <section key={profile} style={{ marginTop: 28 }}>
                  <h3 style={{ textTransform: "capitalize" }}>{profile} access preset</h3>
                  <p className="muted small">Copied into each new workspace. Business Owners can later create explicit member-level exceptions.</p>
                  <div style={{ overflowX: "auto", marginTop: 12 }}>
                    <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
                      <thead><tr><th style={{ textAlign: "left", padding: 10 }}>Module</th>{actionKeys.map((action) => <th key={action} style={{ padding: 10, textTransform: "capitalize" }}>{action}</th>)}</tr></thead>
                      <tbody>
                        {data.features.map((feature) => (
                          <tr key={feature.key} style={{ borderTop: "1px solid var(--border)" }}>
                            <td style={{ padding: 10 }}><strong>{feature.name}</strong></td>
                            {actionKeys.map((action) => (
                              <td key={action} style={{ textAlign: "center", padding: 10 }}>
                                <input
                                  type="checkbox"
                                  checked={Boolean(permissionDraft[profile]?.[feature.key]?.[action])}
                                  onChange={(event) => setPermissionDraft((current) => ({
                                    ...current,
                                    [profile]: {
                                      ...current[profile],
                                      [feature.key]: { ...current[profile][feature.key], [action]: event.target.checked },
                                    },
                                  }))}
                                  aria-label={`${profile} ${feature.name} ${action}`}
                                />
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}

              <div className="settings-note" style={{ marginTop: 24 }}>
                <ShieldCheck size={20} />
                <strong>Snapshot boundary</strong>
                <p>Template changes affect only future provisioning. Existing clients keep their template version, module overrides, workspace defaults and access presets until a separate reviewed migration is introduced.</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
