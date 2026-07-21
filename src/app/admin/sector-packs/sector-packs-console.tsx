"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Eye,
  Layers3,
  Loader2,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { BdbMonogram } from "@/components/brand";
import {
  complianceKeys,
  resolveWorkspaceBlueprint,
  workflowKeys,
  workspaceModuleKeys,
  type ComplianceKey,
  type SectorWorkflowKey,
  type WorkspaceBlueprint,
  type WorkspaceBlueprintOverrides,
  type WorkspaceModuleKey,
} from "@/lib/sector-packs";
import styles from "./sector-packs.module.css";

type Workspace = { id: string; name: string; slug: string; status: string };
type Pack = {
  id: string;
  key: string;
  version: number;
  name: string;
  sector: string;
  description: string;
  config: WorkspaceBlueprint;
  is_active: boolean;
  updated_at: string;
};
type Config = {
  workspace_id: string;
  sector_pack_id: string;
  draft_overrides: WorkspaceBlueprintOverrides;
  published_config: WorkspaceBlueprint | null;
  status: "draft" | "published";
  published_at: string | null;
  updated_at: string;
};
type Dashboard = { workspaces: Workspace[]; packs: Pack[]; configs: Config[] };

const moduleNames: Record<WorkspaceModuleKey, string> = {
  overview: "Overview",
  accounts: "Accounts",
  customers: "Customers",
  calendar: "Calendar",
  communications: "Communications",
  documents: "Documents",
  banking: "Banking",
  reports: "Reports",
  automation: "Automation",
};

const workflowNames: Record<SectorWorkflowKey, string> = {
  "appointment-reminders": "Appointment reminders",
  "missed-appointment-follow-up": "Missed appointment follow-up",
  "new-enquiry-triage": "New enquiry triage",
  "overdue-invoice-follow-up": "Overdue invoice follow-up",
  "document-request-follow-up": "Missing document follow-up",
  "client-onboarding": "Client onboarding",
  "matter-deadline-review": "Matter deadline review",
  "recurring-compliance-check": "Recurring compliance review",
};

const complianceNames: Record<ComplianceKey, string> = {
  "consent-recording": "Consent recording",
  "confidential-notes": "Confidential notes",
  "document-retention": "Document retention",
  "conflict-check": "Conflict checks",
  "engagement-letter": "Engagement letters",
  "identity-verification": "Identity verification",
  "professional-review": "Professional review gate",
};

function toggleValue<T extends string>(values: T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value];
}

export default function SectorPacksConsole() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState("");
  const [selectedPackId, setSelectedPackId] = useState("");
  const [overrides, setOverrides] = useState<WorkspaceBlueprintOverrides>({});
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const applyWorkspace = useCallback((dashboard: Dashboard, workspaceId: string) => {
    const nextWorkspaceId = dashboard.workspaces.some((workspace) => workspace.id === workspaceId)
      ? workspaceId
      : dashboard.workspaces[0]?.id ?? "";
    const existing = dashboard.configs.find((config) => config.workspace_id === nextWorkspaceId);
    setSelectedWorkspaceId(nextWorkspaceId);
    setSelectedPackId(existing?.sector_pack_id ?? dashboard.packs[0]?.id ?? "");
    setOverrides(existing?.draft_overrides ?? {});
  }, []);

  const load = useCallback(async (preferredWorkspaceId = "") => {
    setError("");
    const response = await fetch("/api/admin/sector-packs", { cache: "no-store" });
    if (response.status === 428) { window.location.href = "/mfa"; return; }
    if (response.status === 401) { window.location.href = "/login?next=/admin/sector-packs"; return; }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      setError(result.error === "NOT_CONFIGURED"
        ? "Sector Packs are not connected to Supabase in this environment."
        : result.error ?? "Sector Packs could not be loaded.");
      return;
    }
    const dashboard = result as Dashboard;
    setData(dashboard);
    applyWorkspace(dashboard, preferredWorkspaceId);
  }, [applyWorkspace]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const activeWorkspace = data?.workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? null;
  const storedConfig = data?.configs.find((config) => config.workspace_id === selectedWorkspaceId) ?? null;
  const activePack = data?.packs.find((pack) => pack.id === selectedPackId) ?? null;
  const resolved = useMemo(
    () => resolveWorkspaceBlueprint(activePack?.config, overrides),
    [activePack, overrides],
  );

  function selectWorkspace(workspaceId: string) {
    if (!data) return;
    applyWorkspace(data, workspaceId);
    setNotice("");
    setError("");
  }

  function setLabel(key: keyof WorkspaceBlueprint["labels"], value: string) {
    setOverrides((current) => ({
      ...current,
      labels: { ...current.labels, [key]: value },
    }));
  }

  function toggleModule(key: WorkspaceModuleKey) {
    const current = resolved.navigation.enabled;
    const next = toggleValue(current, key);
    setOverrides((value) => ({
      ...value,
      navigation: {
        ...value.navigation,
        enabled: next.length ? workspaceModuleKeys.filter((item) => next.includes(item)) : ["overview"],
        emphasis: (value.navigation?.emphasis ?? resolved.navigation.emphasis).filter((item) => next.includes(item)),
      },
    }));
  }

  function toggleEmphasis(key: WorkspaceModuleKey) {
    if (!resolved.navigation.enabled.includes(key)) return;
    setOverrides((value) => ({
      ...value,
      navigation: {
        ...value.navigation,
        enabled: value.navigation?.enabled ?? resolved.navigation.enabled,
        emphasis: toggleValue(value.navigation?.emphasis ?? resolved.navigation.emphasis, key),
      },
    }));
  }

  function toggleWorkflow(key: SectorWorkflowKey) {
    setOverrides((current) => ({ ...current, workflows: toggleValue(resolved.workflows, key) }));
  }

  function toggleCompliance(key: ComplianceKey) {
    setOverrides((current) => ({ ...current, compliance: toggleValue(resolved.compliance, key) }));
  }

  async function request(payload: Record<string, unknown>, key: string) {
    setBusy(key);
    setError("");
    setNotice("");
    const response = await fetch("/api/admin/sector-packs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) {
      setError(result.error ?? "The Sector Pack change could not be saved.");
      return false;
    }
    return true;
  }

  async function saveDraft() {
    if (!activeWorkspace || !activePack) return false;
    const ok = await request({
      action: "save-draft",
      workspaceId: activeWorkspace.id,
      sectorPackId: activePack.id,
      overrides,
    }, "save");
    if (ok) {
      setNotice("Draft saved. The client workspace is unchanged until publication.");
      await load(activeWorkspace.id);
    }
    return ok;
  }

  async function publish() {
    if (!activeWorkspace || !activePack) return;
    const saved = await request({
      action: "save-draft",
      workspaceId: activeWorkspace.id,
      sectorPackId: activePack.id,
      overrides,
    }, "publish");
    if (!saved) return;
    const published = await request({ action: "publish", workspaceId: activeWorkspace.id }, "publish");
    if (published) {
      setNotice(`Published ${resolved.name} for ${activeWorkspace.name}.`);
      await load(activeWorkspace.id);
    }
  }

  if (!data && !error) {
    return <main className="admin-loading"><Loader2 className="spin" /> Loading Sector Packs…</main>;
  }

  return (
    <main className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <BdbMonogram />
            <p className="eyebrow" style={{ marginTop: 18 }}>Founder control plane · Sector Packs</p>
            <h1>Configure the client, not another codebase.</h1>
            <p>Start from a sector operating model, apply client-specific terminology and workflows, review the resolved workspace, then publish one audited configuration.</p>
          </div>
          <div className={styles.actions}>
            <Link className="button button-secondary" href="/admin"><ArrowLeft size={16} /> Founder Admin</Link>
            <button className="button button-secondary" onClick={() => void load(selectedWorkspaceId)} disabled={busy !== ""}><RefreshCw size={16} /> Refresh</button>
            <button className="button button-secondary" onClick={() => void saveDraft()} disabled={!activeWorkspace || !activePack || busy !== ""}>{busy === "save" ? <Loader2 className="spin" size={16} /> : <Save size={16} />} Save draft</button>
            <button className="button button-primary" onClick={() => void publish()} disabled={!activeWorkspace || !activePack || busy !== ""}>{busy === "publish" ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />} Publish to client</button>
          </div>
        </header>

        {error && <div className={styles.error} role="alert"><strong>Action needed</strong><div>{error}</div></div>}
        {notice && <div className={styles.notice}><strong>Configuration updated</strong><div>{notice}</div></div>}

        {!data ? (
          <section className={styles.panel}><div className={styles.empty}>Founder Sector Packs are unavailable.</div></section>
        ) : (
          <div className={styles.grid}>
            <section className={styles.panel}>
              <div className={styles.panelHeader}><h2>Client businesses</h2><p>Choose the workspace receiving this configuration.</p></div>
              <div className={styles.clientList}>
                {!data.workspaces.length && <div className={styles.empty}>No client workspaces exist yet.</div>}
                {data.workspaces.map((workspace) => {
                  const config = data.configs.find((item) => item.workspace_id === workspace.id);
                  return (
                    <button key={workspace.id} className={`${styles.clientButton} ${selectedWorkspaceId === workspace.id ? styles.clientButtonActive : ""}`} onClick={() => selectWorkspace(workspace.id)}>
                      <span className={styles.initial}>{workspace.name.slice(0, 2).toUpperCase()}</span>
                      <span><strong>{workspace.name}</strong><small>{config?.status ?? "No pack"} · {workspace.status}</small></span>
                    </button>
                  );
                })}
              </div>
            </section>

            <section className={styles.panel}>
              <div className={styles.panelHeader}>
                <h2>{activeWorkspace?.name ?? "Choose a client"}</h2>
                <p>Draft adjustments are founder-only. The client keeps the previous published blueprint until Publish is confirmed.</p>
              </div>
              {activeWorkspace && activePack ? (
                <div className={styles.editor}>
                  <section className={styles.section}>
                    <div className={styles.sectionHead}><div><h3>Starting template</h3><p>Reusable sector logic, not a forked application.</p></div></div>
                    <div className={styles.field}>
                      <label htmlFor="sector-pack">Sector Pack</label>
                      <select id="sector-pack" value={selectedPackId} onChange={(event) => { setSelectedPackId(event.target.value); setOverrides({}); }}>
                        {data.packs.map((pack) => <option key={pack.id} value={pack.id}>{pack.sector} · {pack.name} · v{pack.version}</option>)}
                      </select>
                    </div>
                    <p className="muted small">{activePack.description}</p>
                  </section>

                  <section className={styles.section}>
                    <div className={styles.sectionHead}><div><h3>Client vocabulary</h3><p>Change the language without changing the underlying records.</p></div></div>
                    <div className={styles.fieldGrid}>
                      {([
                        ["customerSingular", "Customer singular"], ["customerPlural", "Customer plural"],
                        ["appointmentSingular", "Appointment singular"], ["appointmentPlural", "Appointment plural"],
                        ["invoiceSingular", "Invoice singular"], ["invoicePlural", "Invoice plural"],
                        ["documentSingular", "Document singular"], ["documentPlural", "Document plural"],
                      ] as const).map(([key, label]) => (
                        <div className={styles.field} key={key}><label>{label}</label><input value={resolved.labels[key]} onChange={(event) => setLabel(key, event.target.value)} maxLength={40} /></div>
                      ))}
                    </div>
                  </section>

                  <section className={styles.section}>
                    <div className={styles.sectionHead}><div><h3>Workspace departments</h3><p>Visibility shapes the experience. It does not replace security entitlements.</p></div></div>
                    <div className={styles.options}>
                      {workspaceModuleKeys.map((key) => {
                        const enabled = resolved.navigation.enabled.includes(key);
                        const emphasized = resolved.navigation.emphasis.includes(key);
                        return (
                          <div className={`${styles.option} ${enabled ? styles.optionActive : ""}`} key={key}>
                            <button type="button" className={styles.check} onClick={() => toggleModule(key)} aria-label={`${enabled ? "Disable" : "Enable"} ${moduleNames[key]}`}>{enabled && <Check size={14} />}</button>
                            <div style={{ flex: 1 }}><strong>{resolved.labels.navigation[key] || moduleNames[key]}</strong><small>{enabled ? "Visible in the workspace" : "Hidden by this Sector Pack"}</small></div>
                            {enabled && <button type="button" className="button button-quiet" onClick={() => toggleEmphasis(key)}>{emphasized ? "Priority" : "Standard"}</button>}
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  <section className={styles.section}>
                    <div className={styles.sectionHead}><div><h3>Operating workflows</h3><p>Defines the approved workflow catalogue. Provider execution remains separately controlled.</p></div></div>
                    <div className={styles.options}>
                      {workflowKeys.map((key) => {
                        const enabled = resolved.workflows.includes(key);
                        return <button type="button" key={key} className={`${styles.option} ${enabled ? styles.optionActive : ""}`} onClick={() => toggleWorkflow(key)}><span className={styles.check}>{enabled && <Check size={14} />}</span><span><strong>{workflowNames[key]}</strong><small>{enabled ? "Available to configure" : "Not included"}</small></span></button>;
                      })}
                    </div>
                  </section>

                  <section className={styles.section}>
                    <div className={styles.sectionHead}><div><h3>Compliance prompts</h3><p>Operational safeguards, not legal or professional advice.</p></div></div>
                    <div className={styles.options}>
                      {complianceKeys.map((key) => {
                        const enabled = resolved.compliance.includes(key);
                        return <button type="button" key={key} className={`${styles.option} ${enabled ? styles.optionActive : ""}`} onClick={() => toggleCompliance(key)}><span className={styles.check}>{enabled && <Check size={14} />}</span><span><strong>{complianceNames[key]}</strong><small>{enabled ? "Prompt included" : "Prompt omitted"}</small></span></button>;
                      })}
                    </div>
                  </section>
                </div>
              ) : <div className={styles.empty}>Choose a client and an active Sector Pack.</div>}
            </section>

            <aside className={`${styles.panel} ${styles.preview}`}>
              <div className={styles.panelHeader}><h3>Resolved client blueprint</h3><p>Preview of the exact configuration that will be published.</p></div>
              <div className={styles.previewBody}>
                <div className={styles.statusRow}>
                  <span className={`${styles.status} ${storedConfig?.status === "published" ? styles.statusPublished : ""}`}><ShieldCheck size={14} /> {storedConfig?.status === "published" ? "Published" : "Draft only"}</span>
                  <span className={styles.status}><Eye size={14} /> v{resolved.version}</span>
                </div>
                <div><p className="eyebrow">{resolved.sector}</p><h2 style={{ margin: "5px 0" }}>{resolved.name}</h2><p className="muted small">{resolved.description}</p></div>
                <div className={styles.mockNav}><p>Client navigation</p>{resolved.navigation.enabled.map((key) => <span key={key} data-emphasis={resolved.navigation.emphasis.includes(key)}>{resolved.labels.navigation[key] || moduleNames[key]}</span>)}</div>
                <div><h3 style={{ marginBottom: 10 }}>Vocabulary</h3><div className={styles.list}><div className={styles.listItem}>{resolved.labels.customerPlural}</div><div className={styles.listItem}>{resolved.labels.appointmentPlural}</div><div className={styles.listItem}>{resolved.labels.invoicePlural}</div><div className={styles.listItem}>{resolved.labels.documentPlural}</div></div></div>
                <div><h3 style={{ marginBottom: 10 }}>Approved workflows</h3><div className={styles.list}>{resolved.workflows.length ? resolved.workflows.map((key) => <div className={styles.listItem} key={key}>{workflowNames[key]}</div>) : <div className={styles.listItem}>No automated workflows enabled</div>}</div></div>
                <p className={styles.footerNote}><Layers3 size={15} style={{ verticalAlign: "text-bottom", marginRight: 6 }} />Sector Packs configure the shared BDB OS. They never create a separate customer database or industry-specific code fork.</p>
              </div>
            </aside>
          </div>
        )}
      </div>
    </main>
  );
}
