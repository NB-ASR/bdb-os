"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Loader2,
  MailPlus,
  Pencil,
  Search,
  ShieldCheck,
  Trash2,
  UserMinus,
  UserRound,
  XCircle,
} from "lucide-react";
import { invitationCooldownSeconds, invitationDeliveryState } from "@/lib/founder-admin";

export type FounderAccount = {
  id: string;
  email: string;
  full_name: string;
  profile_full_name: string;
  auth_full_name: string;
  name_consistent: boolean;
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
  invitation_last_sent_at: string | null;
  invitation_delivery_status: string | null;
  invitation_delivery_attempted_at: string | null;
  invitation_delivery_error_code: string | null;
};

type SharedProps = {
  accounts: FounderAccount[];
  memberships: FounderAccountMembership[];
  actorUserId: string;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
};

type BusinessProps = SharedProps & { workspace: FounderAccountWorkspace };
type DirectoryProps = SharedProps & { workspaces: FounderAccountWorkspace[] };

const profileLabels: Record<string, string> = {
  owner: "Owner",
  manager: "Manager",
  employee: "Employee",
  custom: "Custom",
};

const invitationLabels = {
  sent: "Invitation sent",
  pending: "Invitation pending",
  expired: "Invitation expired",
  failed: "Invitation failed",
  active: "Active",
  suspended: "Suspended",
};

function formatMoment(value: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function stateClass(state: string) {
  if (state === "active" || state === "sent") return "badge badge-green";
  if (state === "failed" || state === "expired" || state === "suspended") return "badge badge-red";
  return "badge badge-gold";
}

async function accountRequest(
  method: "POST" | "PATCH" | "DELETE",
  payload: Record<string, unknown>,
) {
  const response = await fetch("/api/admin/accounts", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => ({})) as {
    error?: string;
    message?: string;
    membershipCreated?: boolean;
  };
  return { response, result };
}

export function FounderAccountWorkspaces({
  accounts,
  workspace,
  memberships,
  actorUserId,
  onChanged,
  onError,
  onNotice,
}: BusinessProps) {
  const [busy, setBusy] = useState("");
  const [editingId, setEditingId] = useState("");
  const businessMemberships = useMemo(
    () => memberships.filter((membership) => membership.workspace_id === workspace.id),
    [memberships, workspace.id],
  );
  const accountsById = useMemo(
    () => new Map(accounts.map((account) => [account.id, account])),
    [accounts],
  );

  async function requestChange(
    method: "POST" | "PATCH" | "DELETE",
    payload: Record<string, unknown>,
    key: string,
    fallbackMessage: string,
  ) {
    setBusy(key);
    onError("");
    onNotice("");
    const { response, result } = await accountRequest(method, payload);
    setBusy("");
    if (!response.ok) {
      const suffix = result.membershipCreated
        ? " The person was added with a failed invitation; use Resend when email delivery is available."
        : "";
      onError(`${result.error ?? "The user change could not be completed."}${suffix}`);
      if (result.membershipCreated) await onChanged();
      return false;
    }
    onNotice(result.message ?? fallbackMessage);
    await onChanged();
    return true;
  }

  async function inviteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const values = new FormData(formElement);
    const invited = await requestChange(
      "POST",
      {
        action: "invite-account",
        workspaceId: workspace.id,
        fullName: values.get("fullName"),
        email: values.get("email"),
        accessProfile: values.get("accessProfile"),
      },
      "invite-account",
      "Invitation sent.",
    );
    if (invited) formElement.reset();
  }

  async function editUser(event: FormEvent<HTMLFormElement>, account: FounderAccount) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const updated = await requestChange(
      "PATCH",
      {
        action: "edit-user",
        userId: account.id,
        fullName: values.get("fullName"),
        email: values.get("email"),
      },
      `identity-${account.id}`,
      "Name and email updated.",
    );
    if (updated) setEditingId("");
  }

  return (
    <div className="founder-accounts founder-business-users">
      <section className="founder-account-invite admin-panel">
        <div>
          <p className="eyebrow">{workspace.name}</p>
          <h3>Invite a person</h3>
          <p>Add a new or existing person to this business. Email delivery is tracked separately from access.</p>
        </div>
        <form onSubmit={inviteAccount}>
          <div className="field"><label htmlFor={`account-name-${workspace.id}`}>Full name</label><input id={`account-name-${workspace.id}`} name="fullName" minLength={2} required autoComplete="name" /></div>
          <div className="field"><label htmlFor={`account-email-${workspace.id}`}>Work email</label><input id={`account-email-${workspace.id}`} name="email" type="email" required autoComplete="email" /></div>
          <div className="field">
            <label htmlFor={`account-profile-${workspace.id}`}>Access</label>
            <select id={`account-profile-${workspace.id}`} name="accessProfile" defaultValue="employee">
              {Object.entries(profileLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </div>
          <button className="button button-primary" disabled={busy === "invite-account"}>
            {busy === "invite-account" ? <Loader2 className="spin" size={16} /> : <MailPlus size={16} />}
            {busy === "invite-account" ? "Sending…" : "Invite person"}
          </button>
        </form>
      </section>

      <section className="founder-account-list" aria-label={`${workspace.name} users`}>
        {!businessMemberships.length && <div className="admin-panel"><p className="muted">No people have access to this business.</p></div>}
        {businessMemberships.map((membership) => {
          const account = accountsById.get(membership.user_id);
          if (!account) return null;
          const isSelf = account.id === actorUserId;
          const key = `${workspace.id}-${account.id}`;
          const deliveryState = invitationDeliveryState({
            membershipStatus: membership.status,
            deliveryStatus: membership.invitation_delivery_status,
            expiresAt: membership.invitation_expires_at,
          });
          const retryAfter = invitationCooldownSeconds(membership.invitation_delivery_attempted_at);
          const locked = busy === key || isSelf;
          return (
            <article className="founder-account-card" key={key}>
              <header>
                <span className="founder-account-avatar">{(account.full_name || account.email).slice(0, 1).toUpperCase()}</span>
                <div>
                  <h4>{account.full_name || "Name not recorded"}</h4>
                  <p>{account.email}</p>
                </div>
                <div className="founder-account-badges">
                  <span className={stateClass(deliveryState)}>{invitationLabels[deliveryState]}</span>
                  {account.email_confirmed_at
                    ? <span className="badge badge-green"><CheckCircle2 size={12} /> Email verified</span>
                    : <span className="badge"><Clock3 size={12} /> Email unverified</span>}
                  {isSelf && <span className="badge">Your account</span>}
                  {account.is_platform_admin && <span className="badge badge-gold"><ShieldCheck size={12} /> Platform admin</span>}
                  {!account.name_consistent && <span className="badge badge-red"><AlertTriangle size={12} /> Name mismatch</span>}
                </div>
              </header>

              <div className="founder-account-meta">
                <span><small>Last sign-in</small><strong>{formatMoment(account.last_sign_in_at)}</strong></span>
                <span><small>Invitation last sent</small><strong>{formatMoment(membership.invitation_last_sent_at)}</strong></span>
                {membership.status === "invited" && <span><small>Invitation expires</small><strong>{formatMoment(membership.invitation_expires_at)}</strong></span>}
              </div>

              {editingId === account.id ? (
                <form className="founder-account-edit" onSubmit={(event) => void editUser(event, account)}>
                  <div className="field"><label>Full name</label><input name="fullName" defaultValue={account.full_name} minLength={2} required /></div>
                  <div className="field"><label>Work email</label><input name="email" type="email" defaultValue={account.email} required /></div>
                  <button className="button button-primary" disabled={busy === `identity-${account.id}`}>{busy === `identity-${account.id}` ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />} Save identity</button>
                  <button className="button button-secondary" type="button" onClick={() => setEditingId("")}>Cancel</button>
                </form>
              ) : (
                <div className="founder-account-controls">
                  <button className="button button-secondary" onClick={() => setEditingId(account.id)}><Pencil size={14} /> Edit name or email</button>
                  {membership.status === "invited" ? (
                    <>
                      <button className="button button-secondary" disabled={locked || retryAfter > 0} title={retryAfter > 0 ? `Available in ${retryAfter} seconds` : undefined} onClick={() => void requestChange("POST", { action: "resend-invitation", workspaceId: workspace.id, userId: account.id }, key, "Invitation resent.")}>
                        {busy === key ? <Loader2 className="spin" size={14} /> : <MailPlus size={14} />} {retryAfter > 0 ? `Resend in ${retryAfter}s` : "Resend invitation"}
                      </button>
                      <button className="button button-danger" disabled={locked} onClick={() => {
                        if (!window.confirm(`Cancel ${account.email}'s invitation to ${workspace.name}?`)) return;
                        void requestChange("POST", { action: "cancel-invitation", workspaceId: workspace.id, userId: account.id }, key, "Invitation cancelled.");
                      }}><XCircle size={14} /> Cancel invitation</button>
                    </>
                  ) : (
                    <>
                      <label><span>Access</span><select value={membership.access_profile} disabled={locked} onChange={(event) => void requestChange("PATCH", { workspaceId: workspace.id, userId: account.id, accessProfile: event.target.value }, key, "Access profile updated.")}>{Object.entries(profileLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                      <label><span>Status</span><select value={membership.status} disabled={locked} onChange={(event) => {
                        const nextStatus = event.target.value;
                        if (nextStatus === "suspended" && !window.confirm(`Suspend ${account.email}'s access to ${workspace.name}?`)) return;
                        void requestChange("PATCH", { workspaceId: workspace.id, userId: account.id, status: nextStatus }, key, "Access status updated.");
                      }}><option value="active">Active</option><option value="suspended">Suspended</option></select></label>
                      <button className="button button-danger" disabled={locked} onClick={() => {
                        if (!window.confirm(`Remove ${account.email} from ${workspace.name}? Their sign-in account and access to other businesses will remain.`)) return;
                        void requestChange("DELETE", { action: "remove-membership", workspaceId: workspace.id, userId: account.id }, key, "Business access removed.");
                      }}><UserMinus size={14} /> Remove from business</button>
                    </>
                  )}
                </div>
              )}
            </article>
          );
        })}
      </section>
    </div>
  );
}

export function FounderAccountDirectory({
  accounts,
  workspaces,
  memberships,
  actorUserId,
  onChanged,
  onError,
  onNotice,
}: DirectoryProps) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState("");
  const normalizedQuery = query.trim().toLowerCase();
  const visibleAccounts = useMemo(
    () => accounts.filter((account) => !normalizedQuery || `${account.full_name} ${account.email}`.toLowerCase().includes(normalizedQuery)),
    [accounts, normalizedQuery],
  );
  const membershipsByUser = useMemo(() => {
    const byUser = new Map<string, FounderAccountMembership[]>();
    for (const membership of memberships) {
      const records = byUser.get(membership.user_id) ?? [];
      records.push(membership);
      byUser.set(membership.user_id, records);
    }
    return byUser;
  }, [memberships]);
  const workspaceNamesById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace.name])),
    [workspaces],
  );

  async function deleteUnused(account: FounderAccount) {
    if (!window.confirm(`Permanently delete the unused sign-in account ${account.email}? This is separate from removing business access.`)) return;
    setBusy(account.id);
    onError("");
    const { response, result } = await accountRequest("DELETE", {
      action: "delete-unused-account",
      userId: account.id,
    });
    setBusy("");
    if (!response.ok) {
      onError(result.error ?? "The account could not be deleted.");
      return;
    }
    onNotice(result.message ?? "Unused account deleted.");
    await onChanged();
  }

  async function changeAccountStatus(account: FounderAccount, accountStatus: "active" | "suspended") {
    const action = accountStatus === "suspended" ? "suspend sign-in everywhere" : "restore sign-in everywhere";
    if (!window.confirm(`${action} for ${account.email}? Business membership records will remain.`)) return;
    setBusy(account.id);
    onError("");
    const { response, result } = await accountRequest("PATCH", {
      action: "account-auth-status",
      userId: account.id,
      accountStatus,
    });
    setBusy("");
    if (!response.ok) {
      onError(result.error ?? "The sign-in status could not be changed.");
      return;
    }
    onNotice(result.message ?? "Sign-in status updated.");
    await onChanged();
  }

  return (
    <div className="founder-account-directory">
      <div className="admin-section-heading">
        <h2>Account directory</h2>
        <p>Advanced platform diagnostics. Administer normal access from the relevant client business.</p>
      </div>
      <label className="founder-account-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or email" aria-label="Search account directory" /></label>
      <div className="founder-account-list">
        {visibleAccounts.map((account) => {
          const accountMemberships = membershipsByUser.get(account.id) ?? [];
          const isSelf = account.id === actorUserId;
          const authSuspended = Boolean(account.banned_until && new Date(account.banned_until) > new Date());
          return (
            <article className="founder-account-card" key={account.id}>
              <header>
                <span className="founder-account-avatar">{(account.full_name || account.email).slice(0, 1).toUpperCase()}</span>
                <div><h3>{account.full_name || "Name not recorded"}</h3><p>{account.email}</p></div>
                <div className="founder-account-badges">
                  {account.is_platform_admin && <span className="badge badge-gold"><ShieldCheck size={12} /> Platform admin</span>}
                  {!account.name_consistent && <span className="badge badge-red"><AlertTriangle size={12} /> Profile/Auth mismatch</span>}
                  {!accountMemberships.length && <span className="badge"><UserRound size={12} /> No business access</span>}
                  {authSuspended && <span className="badge badge-red">Sign-in suspended</span>}
                </div>
              </header>
              <div className="founder-account-meta">
                <span><small>Business access</small><strong>{accountMemberships.length ? accountMemberships.map((membership) => workspaceNamesById.get(membership.workspace_id) ?? "Unknown").join(", ") : "None"}</strong></span>
                <span><small>Last sign-in</small><strong>{formatMoment(account.last_sign_in_at)}</strong></span>
              </div>
              {!account.is_platform_admin && !isSelf && (
                <div className="founder-account-controls">
                  <button className={authSuspended ? "button button-secondary" : "button button-danger"} disabled={busy === account.id} onClick={() => void changeAccountStatus(account, authSuspended ? "active" : "suspended")}>
                    {busy === account.id ? <Loader2 className="spin" size={14} /> : authSuspended ? <CheckCircle2 size={14} /> : <XCircle size={14} />} {authSuspended ? "Restore sign-in" : "Suspend sign-in everywhere"}
                  </button>
                  {!accountMemberships.length && <button className="button button-danger" disabled={busy === account.id} onClick={() => void deleteUnused(account)}><Trash2 size={14} /> Delete unused account</button>}
                </div>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
