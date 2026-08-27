"use client";

import { FormEvent, useMemo, useState } from "react";
import { CheckCircle2, Clock3, Loader2, MailPlus, Search, ShieldCheck, UserRound, UsersRound } from "lucide-react";

export type FounderAccount = {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  banned_until: string | null;
  is_platform_admin: boolean;
};

export type FounderAccountWorkspace = {
  id: string;
  name: string;
  slug: string;
  status: string;
};

export type FounderAccountMembership = {
  workspace_id: string;
  user_id: string;
  access_profile: string;
  status: string;
  invitation_expires_at: string | null;
};

type Props = {
  accounts: FounderAccount[];
  workspaces: FounderAccountWorkspace[];
  memberships: FounderAccountMembership[];
  actorUserId: string;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

const profileLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  employee: "Employee",
  custom: "Custom",
};

function formatMoment(value: string | null) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function FounderAccountWorkspaces({
  accounts,
  workspaces,
  memberships,
  actorUserId,
  onChanged,
  onError,
  onNotice,
}: Props) {
  const [query, setQuery] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [busy, setBusy] = useState("");

  const visibleAccounts = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return accounts.filter((account) => {
      const accountMemberships = memberships.filter((membership) => membership.user_id === account.id);
      const matchesWorkspace = !workspaceFilter
        || accountMemberships.some((membership) => membership.workspace_id === workspaceFilter);
      const workspaceNames = accountMemberships
        .map((membership) => workspaces.find((workspace) => workspace.id === membership.workspace_id)?.name ?? "")
        .join(" ");
      const matchesQuery = !normalized
        || `${account.full_name} ${account.email} ${workspaceNames}`.toLowerCase().includes(normalized);
      return matchesWorkspace && matchesQuery;
    });
  }, [accounts, memberships, query, workspaceFilter, workspaces]);

  async function requestAccountChange(
    method: "POST" | "PATCH",
    payload: Record<string, unknown>,
    key: string,
    successMessage: string,
  ) {
    setBusy(key);
    onError("");
    onNotice("");
    const response = await fetch("/api/admin/accounts", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({})) as { error?: string; message?: string };
    setBusy("");
    if (!response.ok) {
      onError(result.error ?? "The account change could not be completed.");
      return false;
    }
    onNotice(result.message ?? successMessage);
    await onChanged();
    return true;
  }

  async function inviteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const invited = await requestAccountChange(
      "POST",
      {
        action: "invite-account",
        workspaceId: values.get("workspaceId"),
        fullName: values.get("fullName"),
        email: values.get("email"),
        accessProfile: values.get("accessProfile"),
      },
      "invite-account",
      "Workspace invitation sent.",
    );
    if (invited) form.reset();
  }

  const pendingInvites = memberships.filter((membership) => membership.status === "invited").length;
  const suspendedMemberships = memberships.filter((membership) => membership.status === "suspended").length;
  const assignedUsers = new Set(memberships.map((membership) => membership.user_id));
  const unassignedAccounts = accounts.filter((account) => !assignedUsers.has(account.id)).length;

  return (
    <div className="founder-accounts">
      <section className="founder-account-stats" aria-label="Account summary">
        <article><UsersRound size={18} /><span><strong>{accounts.length}</strong><small>Auth accounts</small></span></article>
        <article><Clock3 size={18} /><span><strong>{pendingInvites}</strong><small>Pending invitations</small></span></article>
        <article><ShieldCheck size={18} /><span><strong>{suspendedMemberships}</strong><small>Suspended memberships</small></span></article>
        <article><UserRound size={18} /><span><strong>{unassignedAccounts}</strong><small>No workspace access</small></span></article>
      </section>

      <section className="founder-account-invite admin-panel">
        <div>
          <p className="eyebrow">Workspace access</p>
          <h2>Invite an account</h2>
          <p>Add a new or existing Supabase Auth account to one isolated workspace. Invitations expire automatically.</p>
        </div>
        <form onSubmit={inviteAccount}>
          <div className="field">
            <label htmlFor="account-workspace">Workspace</label>
            <select id="account-workspace" name="workspaceId" required defaultValue="">
              <option value="" disabled>Select workspace</option>
              {workspaces.filter((workspace) => ["trial", "active"].includes(workspace.status)).map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name} · {workspace.status}</option>
              ))}
            </select>
          </div>
          <div className="field"><label htmlFor="account-name">Full name</label><input id="account-name" name="fullName" minLength={2} required autoComplete="name" /></div>
          <div className="field"><label htmlFor="account-email">Work email</label><input id="account-email" name="email" type="email" required autoComplete="email" /></div>
          <div className="field">
            <label htmlFor="account-profile">Access profile</label>
            <select id="account-profile" name="accessProfile" defaultValue="employee">
              {Object.entries(profileLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <button className="button button-primary" disabled={busy === "invite-account"}>
            {busy === "invite-account" ? <Loader2 className="spin" size={16} /> : <MailPlus size={16} />}
            {busy === "invite-account" ? "Sending…" : "Invite account"}
          </button>
        </form>
      </section>

      <section className="founder-account-directory">
        <div className="founder-account-toolbar">
          <label className="founder-account-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or workspace" aria-label="Search accounts" /></label>
          <select value={workspaceFilter} onChange={(event) => setWorkspaceFilter(event.target.value)} aria-label="Filter accounts by workspace">
            <option value="">All workspaces</option>
            {workspaces.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}
          </select>
        </div>

        <div className="founder-account-list">
          {!visibleAccounts.length && <div className="admin-panel"><p className="muted">No accounts match these filters.</p></div>}
          {visibleAccounts.map((account) => {
            const accountMemberships = memberships.filter((membership) => membership.user_id === account.id);
            const isSelf = account.id === actorUserId;
            return (
              <article className="founder-account-card" key={account.id}>
                <header>
                  <span className="founder-account-avatar">{(account.full_name || account.email).slice(0, 1).toUpperCase()}</span>
                  <div>
                    <h3>{account.full_name || "Name not recorded"}</h3>
                    <p>{account.email || "Email unavailable"}</p>
                  </div>
                  <div className="founder-account-badges">
                    {isSelf && <span className="badge">Your account</span>}
                    {account.is_platform_admin && <span className="badge badge-gold"><ShieldCheck size={12} /> Platform admin</span>}
                    {account.email_confirmed_at && <span className="badge badge-green"><CheckCircle2 size={12} /> Email verified</span>}
                    {account.banned_until && new Date(account.banned_until) > new Date() && <span className="badge badge-red">Auth blocked</span>}
                  </div>
                </header>
                <div className="founder-account-meta">
                  <span><small>Last sign-in</small><strong>{formatMoment(account.last_sign_in_at)}</strong></span>
                  <span><small>Account created</small><strong>{formatMoment(account.created_at)}</strong></span>
                </div>

                <div className="founder-account-memberships">
                  {!accountMemberships.length && <div className="founder-account-empty"><UserRound size={16} /> No workspace access</div>}
                  {accountMemberships.map((membership) => {
                    const workspace = workspaces.find((candidate) => candidate.id === membership.workspace_id);
                    const key = `${membership.workspace_id}-${account.id}`;
                    const locked = busy === key || isSelf;
                    return (
                      <div className="founder-account-membership" key={key}>
                        <span className="founder-account-workspace"><strong>{workspace?.name ?? "Unknown workspace"}</strong><small>{workspace?.slug ?? membership.workspace_id} · {workspace?.status ?? "unknown"}</small></span>
                        {membership.status === "invited" ? (
                          <span className="founder-account-pending">
                            <span className="badge badge-gold">Invitation pending</span>
                            <small>Expires {formatMoment(membership.invitation_expires_at)}</small>
                            <button className="button button-secondary" disabled={locked} onClick={() => void requestAccountChange("POST", { action: "resend-invitation", workspaceId: membership.workspace_id, userId: account.id }, key, "Invitation resent.")}>{busy === key ? <Loader2 className="spin" size={14} /> : <MailPlus size={14} />} Resend</button>
                          </span>
                        ) : (
                          <div className="founder-account-controls">
                            <label><span>Profile</span><select value={membership.access_profile} disabled={locked} onChange={(event) => void requestAccountChange("PATCH", { workspaceId: membership.workspace_id, userId: account.id, accessProfile: event.target.value }, key, "Access profile updated.")}>{Object.entries(profileLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                            <label><span>Status</span><select value={membership.status} disabled={locked} onChange={(event) => {
                              const nextStatus = event.target.value;
                              if (nextStatus === "suspended" && !window.confirm(`Suspend ${account.email}'s access to ${workspace?.name ?? "this workspace"}?`)) return;
                              void requestAccountChange("PATCH", { workspaceId: membership.workspace_id, userId: account.id, status: nextStatus }, key, "Membership status updated.");
                            }}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
                            {busy === key && <Loader2 className="spin" size={16} />}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}

