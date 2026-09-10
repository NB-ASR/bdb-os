"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, DatabaseBackup, Download, FlaskConical, Loader2, ShieldCheck, Trash2 } from "lucide-react";

type Scope = "customers" | "products" | "services" | "sales" | "workspace";
type Designation = { target_workspace_id: string; reason: string; enabled_at: string; enabled_by: string };
type Snapshot = { id: string; scope: Scope; checksum: string; created_at: string; expires_at: string; created_by: string };
type Preview = {
  scope: Scope;
  can_reset: boolean;
  affected_total: number;
  affected_counts: Record<string, number>;
  blocker_total: number;
  blocker_counts: Record<string, number>;
};

const scopes: Array<{ key: Scope; label: string; description: string }> = [
  { key: "customers", label: "Customers", description: "Customers, import reviews, notes and Customer command history." },
  { key: "products", label: "Products", description: "Products, supplier links and Product command history." },
  { key: "services", label: "Services", description: "Services, staff eligibility and Service command history." },
  { key: "sales", label: "Sales", description: "Sales, sale lines, drafts and Sale command history." },
  { key: "workspace", label: "Entire workspace", description: "All operational test data. Access, configuration, billing and audit history remain." },
];

function formatMoment(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function FounderDevelopmentTools({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [designation, setDesignation] = useState<Designation | null>(null);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [scope, setScope] = useState<Scope>("customers");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [reason, setReason] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const selectedScope = scopes.find((candidate) => candidate.key === scope)!;

  const load = useCallback(async () => {
    setBusy("load");
    const response = await fetch(`/api/admin/development-tools?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setError(result.error ?? "Development tools could not be loaded."); return; }
    setDesignation(result.designation ?? null);
    setSnapshots(result.snapshots ?? []);
  }, [workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function designate(enabled: boolean) {
    setBusy("designation"); setError(""); setNotice("");
    const response = await fetch("/api/admin/development-tools", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-designation", workspaceId, enabled, expectedName: workspaceName, reason, confirmation, email, password }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(""); setPassword("");
    if (!response.ok) { setError(result.error ?? "The development-workspace designation could not be changed."); return; }
    setConfirmation(""); setPreview(null);
    setNotice(enabled ? `${workspaceName} is now an explicitly controlled development workspace.` : "Development reset access disabled.");
    await load();
  }

  async function review() {
    setBusy("preview"); setError(""); setNotice(""); setPreview(null); setConfirmation("");
    const response = await fetch("/api/admin/development-tools", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "preview", workspaceId, scope }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok || !result.preview) { setError(result.error ?? "The reset safety review could not be completed."); return; }
    setPreview(result.preview);
  }

  async function reset() {
    if (!preview?.can_reset) return;
    setBusy("reset"); setError(""); setNotice("");
    const response = await fetch("/api/admin/development-tools", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "reset", workspaceId, scope, expectedName: workspaceName, confirmation, email, password,
        idempotencyKey: crypto.randomUUID(),
      }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy(""); setPassword("");
    if (!response.ok) { setError(result.error ?? "The development reset could not be completed."); return; }
    setConfirmation(""); setPreview(null);
    setNotice(`${selectedScope.label} reset completed. A private recovery snapshot was retained before deletion.`);
    await load();
  }

  if (busy === "load" && !designation && snapshots.length === 0) {
    return <div className="admin-panel founder-development-loading"><Loader2 className="spin" size={18} /> Loading guarded development controls…</div>;
  }

  return (
    <section className="founder-development-tools">
      <div className="admin-section-heading">
        <h3>Development tools</h3>
        <p>Founder-only destructive controls for sanitised mock and test workspaces. MFA and current-password verification are enforced server-side.</p>
      </div>
      {error ? <div className="admin-alert danger"><AlertTriangle size={16} /> {error}</div> : null}
      {notice ? <div className="admin-alert"><ShieldCheck size={16} /> {notice}</div> : null}

      {!designation ? (
        <article className="admin-panel founder-development-enable">
          <span className="founder-development-icon"><FlaskConical size={22} /></span>
          <div>
            <h4>Not a development workspace</h4>
            <p>Reset tools are locked. Commercially active workspaces cannot be designated. Use only sanitised, non-customer data.</p>
            <div className="admin-form-grid founder-development-form">
              <div className="field"><label>Development purpose</label><input value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Mock acceptance and import testing" /></div>
              <div className="field"><label>Signed-in Founder email</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></div>
              <div className="field"><label>Current password</label><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div>
              <div className="field"><label>Type <strong>ENABLE DEVELOPMENT {workspaceName}</strong></label><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></div>
            </div>
            <button className="button button-danger" disabled={busy === "designation" || reason.trim().length < 8 || confirmation !== `ENABLE DEVELOPMENT ${workspaceName}` || !email || !password} onClick={() => void designate(true)}>
              {busy === "designation" ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />} Enable guarded development tools
            </button>
          </div>
        </article>
      ) : (
        <>
          <div className="settings-note founder-development-status">
            <ShieldCheck size={18} /><div><strong>Development workspace enabled</strong><p>{designation.reason} · enabled {formatMoment(designation.enabled_at)}</p></div>
          </div>
          <div className="founder-development-scope-grid">
            {scopes.map((candidate) => (
              <button key={candidate.key} className={scope === candidate.key ? "active" : ""} onClick={() => { setScope(candidate.key); setPreview(null); setConfirmation(""); }}>
                <strong>{candidate.label}</strong><span>{candidate.description}</span>
              </button>
            ))}
          </div>
          <article className="admin-panel">
            <h4>Review {selectedScope.label.toLowerCase()} reset</h4>
            <p>No deletion occurs during review. Linked records outside the selected scope block the reset.</p>
            <button className="button button-secondary" onClick={() => void review()} disabled={busy === "preview"}>{busy === "preview" ? <Loader2 className="spin" size={15} /> : <Trash2 size={15} />} Review affected records</button>
            {preview ? (
              <div className="founder-development-preview">
                <div className={`settings-note ${preview.can_reset ? "" : "danger"}`}>
                  <strong>{preview.can_reset ? `${preview.affected_total} records ready to reset` : `Reset blocked by ${preview.blocker_total} linked records`}</strong>
                  <p>{Object.entries(preview.can_reset ? preview.affected_counts : preview.blocker_counts).map(([table, count]) => `${table}: ${count}`).join(" · ") || "No records found."}</p>
                </div>
                {preview.can_reset ? (
                  <div className="admin-form-grid founder-development-form">
                    <div className="field"><label>Signed-in Founder email</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></div>
                    <div className="field"><label>Current password</label><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div>
                    <div className="field founder-development-confirm"><label>Type <strong>RESET {scope.toUpperCase()} IN {workspaceName}</strong></label><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></div>
                    <button className="button button-danger" disabled={busy === "reset" || confirmation !== `RESET ${scope.toUpperCase()} IN ${workspaceName}` || !email || !password} onClick={() => void reset()}>{busy === "reset" ? <Loader2 className="spin" size={15} /> : <DatabaseBackup size={15} />} Create snapshot and reset</button>
                  </div>
                ) : <p className="founder-development-blocked">Clear the linked module as part of an entire-workspace reset, or remove the dependencies through normal product workflows.</p>}
              </div>
            ) : null}
          </article>

          <article className="admin-panel">
            <h4>Recovery snapshots</h4>
            <p>Every completed reset creates a private full-workspace snapshot retained for 30 days.</p>
            {snapshots.length ? <div className="founder-development-snapshots">{snapshots.map((snapshot) => (
              <a key={snapshot.id} href={`/api/admin/development-tools?workspaceId=${encodeURIComponent(workspaceId)}&snapshotId=${encodeURIComponent(snapshot.id)}`}>
                <Download size={14} /><span><strong>{scopes.find((candidate) => candidate.key === snapshot.scope)?.label ?? snapshot.scope}</strong><small>{formatMoment(snapshot.created_at)} · {snapshot.checksum.slice(0, 12)}…</small></span>
              </a>
            ))}</div> : <div className="founder-development-empty">No reset snapshots yet.</div>}
          </article>

          <article className="admin-panel founder-development-disable">
            <h4>Disable development tools</h4>
            <p>Lock destructive reset actions when testing is complete. Existing recovery snapshots remain until expiry.</p>
            <div className="admin-form-grid founder-development-form">
              <div className="field"><label>Signed-in Founder email</label><input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" /></div>
              <div className="field"><label>Current password</label><input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" /></div>
              <div className="field founder-development-confirm"><label>Type <strong>DISABLE DEVELOPMENT {workspaceName}</strong></label><input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></div>
              <button className="button button-secondary" disabled={busy === "designation" || confirmation !== `DISABLE DEVELOPMENT ${workspaceName}` || !email || !password} onClick={() => void designate(false)}>{busy === "designation" ? <Loader2 className="spin" size={15} /> : <ShieldCheck size={15} />} Disable tools</button>
            </div>
          </article>
        </>
      )}
    </section>
  );
}
