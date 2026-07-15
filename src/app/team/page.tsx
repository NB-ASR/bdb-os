"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  Check,
  Clock3,
  Loader2,
  MailPlus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  UserRoundCog,
  UsersRound,
} from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, SectionHeading } from "@/components/ui";

const actionKeys = ["view", "create", "edit", "delete", "approve", "export"] as const;
type ActionKey = (typeof actionKeys)[number];
type Feature = { key: string; name: string; description: string; category: string; route: string | null };
type Permission = {
  user_id: string;
  feature_key: string;
  can_view: boolean;
  can_create: boolean;
  can_edit: boolean;
  can_delete: boolean;
  can_approve: boolean;
  can_export: boolean;
};
type Member = {
  user_id: string;
  role: string;
  access_profile: "owner" | "manager" | "employee" | "custom";
  status: "invited" | "active" | "suspended";
  email: string;
  joined_at: string | null;
  invitation_expires_at: string | null;
  invitation_last_sent_at: string | null;
  profiles?: { full_name?: string | null } | null;
};
type TeamData = { members: Member[]; permissions: Permission[]; features: Feature[]; canEdit: boolean };
type PermissionDraft = Record<string, Record<ActionKey, boolean>>;

function profileLabel(profile: Member["access_profile"]) {
  return profile === "owner" ? "Owner" : profile === "manager" ? "Manager" : profile === "custom" ? "Custom" : "Employee";
}

function preset(profile: Member["access_profile"], action: ActionKey) {
  if (profile === "owner") return true;
  if (profile === "manager") return ["view", "create", "edit", "approve", "export"].includes(action);
  if (profile === "employee") return ["view", "create", "edit"].includes(action);
  return false;
}

function makeDraft(member: Member, features: Feature[], permissions: Permission[]): PermissionDraft {
  return Object.fromEntries(
    features.map((feature) => {
      const explicit = permissions.find((item) => item.user_id === member.user_id && item.feature_key === feature.key);
      return [
        feature.key,
        Object.fromEntries(
          actionKeys.map((action) => [
            action,
            explicit ? Boolean(explicit[`can_${action}` as keyof Permission]) : preset(member.access_profile, action),
          ]),
        ) as Record<ActionKey, boolean>,
      ];
    }),
  );
}

export default function TeamPage() {
  const [data, setData] = useState<TeamData | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draftProfile, setDraftProfile] = useState<Member["access_profile"]>("employee");
  const [draftStatus, setDraftStatus] = useState<Member["status"]>("active");
  const [permissionDraft, setPermissionDraft] = useState<PermissionDraft>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    const response = await fetch("/api/workspace/team", { cache: "no-store" });
    const result = await response.json().catch(() => ({}));
    setLoading(false);
    if (!response.ok) {
      setError(result.error ?? "Team Management could not be loaded.");
      return;
    }
    const next = result as TeamData;
    setData(next);
    setSelectedId((current) => current && next.members.some((member) => member.user_id === current) ? current : next.members[0]?.user_id ?? null);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const selected = useMemo(
    () => data?.members.find((member) => member.user_id === selectedId) ?? null,
    [data, selectedId],
  );

  useEffect(() => {
    if (!selected || !data) return;
    setDraftProfile(selected.access_profile);
    setDraftStatus(selected.status === "invited" ? "active" : selected.status);
    setPermissionDraft(makeDraft(selected, data.features, data.permissions));
  }, [selected, data]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy("invite");
    setError("");
    setNotice("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/workspace/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: form.get("email"), accessProfile: form.get("accessProfile") }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setError(result.error ?? "The invitation could not be sent."); return; }
    event.currentTarget.reset();
    setNotice(result.message ?? "Invitation sent.");
    await load();
  }

  function applyProfile(profile: Member["access_profile"]) {
    setDraftProfile(profile);
    if (!data) return;
    setPermissionDraft(Object.fromEntries(data.features.map((feature) => [
      feature.key,
      Object.fromEntries(actionKeys.map((action) => [action, preset(profile, action)])) as Record<ActionKey, boolean>,
    ])));
  }

  async function saveMember() {
    if (!selected || !data) return;
    setBusy("save");
    setError("");
    setNotice("");
    const permissions = data.features.map((feature) => ({
      featureKey: feature.key,
      ...Object.fromEntries(actionKeys.map((action) => [`can_${action}`, Boolean(permissionDraft[feature.key]?.[action])])),
    }));
    const response = await fetch("/api/workspace/team", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: selected.user_id, accessProfile: draftProfile, status: draftStatus, permissions }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setError(result.error ?? "The team member could not be updated."); return; }
    setNotice("Team access updated.");
    await load();
  }

  async function resend(member: Member) {
    setBusy(`resend-${member.user_id}`);
    setError("");
    const response = await fetch("/api/workspace/team", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resend", userId: member.user_id }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setError(result.error ?? "The invitation could not be resent."); return; }
    setNotice(result.message ?? "Invitation resent.");
    await load();
  }

  async function remove(member: Member) {
    if (!window.confirm(`Remove ${member.profiles?.full_name || member.email} from this business? Their account will remain, but this workspace access will end.`)) return;
    setBusy(`remove-${member.user_id}`);
    setError("");
    const response = await fetch("/api/workspace/team", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: member.user_id }),
    });
    const result = await response.json().catch(() => ({}));
    setBusy("");
    if (!response.ok) { setError(result.error ?? "The team member could not be removed."); return; }
    setSelectedId(null);
    setNotice("Team member removed.");
    await load();
  }

  if (loading && !data) return <div className="page-loading"><Loader2 className="spin" /> Loading Team Management…</div>;

  return (
    <>
      <PageHeader
        eyebrow="Business administration"
        title="Team Management"
        description="Invite employees, assign understandable roles, and control exactly which business modules and actions each person can use."
        action={<Button variant="secondary" onClick={() => void load()} disabled={loading}><RefreshCw size={16} /> Refresh</Button>}
      />
      {error && <Card className="settings-note"><strong>Action needed</strong><p>{error}</p></Card>}
      {notice && <div className="toast"><Check size={17} /> {notice}</div>}

      <div className="settings-layout" style={{ alignItems: "start" }}>
        <Card className="settings-card">
          <SectionHeading title="People" description="Only invited email addresses can activate access to this business." />
          {!data?.members.length ? (
            <EmptyState icon={<UsersRound />} title="No team members" description="Invite the first employee using the form beside this list." />
          ) : (
            <div className="team-list">
              {data.members.map((member) => (
                <button
                  type="button"
                  key={member.user_id}
                  onClick={() => setSelectedId(member.user_id)}
                  className={selectedId === member.user_id ? "active" : ""}
                  style={{ width: "100%", textAlign: "left", border: selectedId === member.user_id ? "1px solid var(--accent)" : undefined }}
                >
                  <span className="profile-avatar">{(member.profiles?.full_name || member.email).slice(0, 2).toUpperCase()}</span>
                  <span style={{ flex: 1 }}>
                    <strong>{member.profiles?.full_name || member.email}</strong>
                    <small>{member.email}</small>
                  </span>
                  <span>
                    <Badge tone={member.status === "active" ? "green" : member.status === "suspended" ? "red" : "gold"}>{member.status}</Badge>
                    <small style={{ display: "block", marginTop: 6 }}>{profileLabel(member.access_profile)}</small>
                  </span>
                </button>
              ))}
            </div>
          )}
        </Card>

        <Card className="settings-card">
          <SectionHeading title="Invite employee" description="The link expires after seven days and access remains pending until activation is completed." />
          <form onSubmit={invite}>
            <div className="field"><label>Work email</label><input name="email" type="email" required disabled={!data?.canEdit || busy === "invite"} /></div>
            <div className="field" style={{ marginTop: 14 }}>
              <label>Starting access</label>
              <select name="accessProfile" defaultValue="employee" disabled={!data?.canEdit || busy === "invite"}>
                <option value="employee">Employee · daily work</option>
                <option value="manager">Manager · operations and approvals</option>
                <option value="custom">Custom · choose every permission</option>
                <option value="owner">Owner · full business administration</option>
              </select>
            </div>
            <Button type="submit" disabled={!data?.canEdit || busy === "invite"} style={{ marginTop: 18 }}>
              {busy === "invite" ? <Loader2 className="spin" size={16} /> : <MailPlus size={16} />}
              {busy === "invite" ? "Sending…" : "Send secure invitation"}
            </Button>
          </form>
        </Card>
      </div>

      {selected && data && (
        <Card className="settings-card" style={{ marginTop: 24 }}>
          <SectionHeading
            title={selected.profiles?.full_name || selected.email}
            description={`${selected.email} · ${selected.status === "invited" ? "Awaiting account activation" : profileLabel(selected.access_profile)}`}
            action={selected.status === "invited" ? (
              <Button variant="secondary" onClick={() => void resend(selected)} disabled={!data.canEdit || busy === `resend-${selected.user_id}`}>
                {busy === `resend-${selected.user_id}` ? <Loader2 className="spin" size={15} /> : <Clock3 size={15} />} Resend invitation
              </Button>
            ) : undefined}
          />
          <div className="form-grid" style={{ marginBottom: 24 }}>
            <div className="field">
              <label>Access profile</label>
              <select value={draftProfile} onChange={(event) => applyProfile(event.target.value as Member["access_profile"])} disabled={!data.canEdit}>
                <option value="owner">Owner</option>
                <option value="manager">Manager</option>
                <option value="employee">Employee</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <div className="field">
              <label>Account status</label>
              <select value={draftStatus} onChange={(event) => setDraftStatus(event.target.value as Member["status"])} disabled={!data.canEdit || selected.status === "invited"}>
                <option value="active">Active</option>
                <option value="suspended">Suspended</option>
              </select>
            </div>
          </div>

          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: 12 }}>Module</th>
                  {actionKeys.map((action) => <th key={action} style={{ padding: 12, textTransform: "capitalize" }}>{action}</th>)}
                </tr>
              </thead>
              <tbody>
                {data.features.map((feature) => (
                  <tr key={feature.key} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: 12 }}><strong>{feature.name}</strong><small style={{ display: "block" }}>{feature.description}</small></td>
                    {actionKeys.map((action) => (
                      <td key={action} style={{ textAlign: "center", padding: 12 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(permissionDraft[feature.key]?.[action])}
                          disabled={!data.canEdit || draftProfile === "owner" || draftProfile !== "custom"}
                          onChange={(event) => setPermissionDraft((current) => ({
                            ...current,
                            [feature.key]: { ...current[feature.key], [action]: event.target.checked },
                          }))}
                          aria-label={`${feature.name}: ${action}`}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {draftProfile !== "custom" && <p className="muted small" style={{ marginTop: 14 }}>The matrix shows the standard {profileLabel(draftProfile)} preset. Choose Custom to edit individual permissions.</p>}
          <div className="dialog-actions" style={{ marginTop: 20 }}>
            <Button variant="danger" type="button" onClick={() => void remove(selected)} disabled={!data.canEdit || busy === `remove-${selected.user_id}`}>
              <Trash2 size={16} /> Remove access
            </Button>
            <Button type="button" onClick={() => void saveMember()} disabled={!data.canEdit || busy === "save"}>
              {busy === "save" ? <Loader2 className="spin" size={16} /> : <UserRoundCog size={16} />}
              {busy === "save" ? "Saving…" : "Save access"}
            </Button>
          </div>
          <div className="settings-note" style={{ marginTop: 18 }}>
            <ShieldCheck size={20} /><strong>Server enforced</strong><p>These controls update database permissions. Hiding a menu item alone never grants or removes access.</p>
          </div>
        </Card>
      )}
    </>
  );
}
