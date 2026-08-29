"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  BriefcaseBusiness,
  CheckCircle2,
  ChevronRight,
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
import type {
  FounderAccount,
  FounderAccountMembership,
  FounderAccountWorkspace,
} from "@/components/founder-account-workspaces";
import {
  filterAccountDirectory,
  isAccountGloballySuspended,
  type AccountDirectoryFilter,
} from "@/lib/founder-account-directory";
import { invitationCooldownSeconds, invitationDeliveryState } from "@/lib/founder-admin";

type DirectoryProps = {
  accounts: FounderAccount[];
  workspaces: FounderAccountWorkspace[];
  memberships: FounderAccountMembership[];
  actorUserId: string;
  onChanged: () => Promise<void>;
  onError: (message: string) => void;
  onNotice: (message: string) => void;
  onOpenBusiness: (workspaceId: string) => void;
};

const filters: Array<{ key: AccountDirectoryFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "suspended", label: "Suspended" },
  { key: "platform-admins", label: "Platform Admins" },
  { key: "no-business", label: "No Business Access" },
  { key: "problems", label: "Pending / Problems" },
];

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
  };
  return { response, result };
}

export function FounderAccountDirectory({
  accounts,
  workspaces,
  memberships,
  actorUserId,
  onChanged,
  onError,
  onNotice,
  onOpenBusiness,
}: DirectoryProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<AccountDirectoryFilter>("all");
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [busy, setBusy] = useState("");

  const visibleAccounts = useMemo(
    () => filterAccountDirectory(accounts, memberships, workspaces, query, filter),
    [accounts, filter, memberships, query, workspaces],
  );
  const selectedAccount = accounts.find((account) => account.id === selectedAccountId) ?? null;
  const selectedMemberships = useMemo(
    () => selectedAccount ? memberships.filter((membership) => membership.user_id === selectedAccount.id) : [],
    [memberships, selectedAccount],
  );
  const workspaceById = useMemo(
    () => new Map(workspaces.map((workspace) => [workspace.id, workspace])),
    [workspaces],
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
      onError(result.error ?? "The account change could not be completed.");
      return false;
    }
    onNotice(result.message ?? fallbackMessage);
    await onChanged();
    return true;
  }

  async function editIdentity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccount) return;
    const values = new FormData(event.currentTarget);
    const changed = await requestChange(
      "PATCH",
      {
        action: "edit-user",
        userId: selectedAccount.id,
        fullName: values.get("fullName"),
        email: values.get("email"),
      },
      `identity-${selectedAccount.id}`,
      "Name and email updated.",
    );
    if (changed) setEditingIdentity(false);
  }

  async function changeAccountStatus(account: FounderAccount, accountStatus: "active" | "suspended") {
    const action = accountStatus === "suspended" ? "suspend sign-in everywhere" : "restore sign-in everywhere";
    if (!window.confirm(`${action} for ${account.email}? Business membership records will remain.`)) return;
    await requestChange(
      "PATCH",
      { action: "account-auth-status", userId: account.id, accountStatus },
      `auth-${account.id}`,
      accountStatus === "suspended" ? "Sign-in suspended across BDB OS." : "Sign-in restored across BDB OS.",
    );
  }

  async function deleteUnused(account: FounderAccount) {
    if (!window.confirm(`Permanently delete the unused sign-in account ${account.email}? This cannot be undone.`)) return;
    const deleted = await requestChange(
      "DELETE",
      { action: "delete-unused-account", userId: account.id },
      `delete-${account.id}`,
      "Unused account deleted.",
    );
    if (deleted) {
      setSelectedAccountId(null);
      setEditingIdentity(false);
    }
  }

  async function removeMembership(account: FounderAccount, membership: FounderAccountMembership) {
    const workspace = workspaceById.get(membership.workspace_id);
    if (!workspace) return;
    if (!window.confirm(`Remove ${account.email} from ${workspace.name}? Their BDB OS sign-in and any other business access will remain.`)) return;
    await requestChange(
      "DELETE",
      { action: "remove-membership", workspaceId: workspace.id, userId: account.id },
      `membership-${workspace.id}`,
      `Access to ${workspace.name} removed.`,
    );
  }

  async function resendInvitation(account: FounderAccount, membership: FounderAccountMembership) {
    const workspace = workspaceById.get(membership.workspace_id);
    if (!workspace) return;
    await requestChange(
      "POST",
      { action: "resend-invitation", workspaceId: workspace.id, userId: account.id },
      `membership-${workspace.id}`,
      `Invitation resent for ${workspace.name}.`,
    );
  }

  async function cancelInvitation(account: FounderAccount, membership: FounderAccountMembership) {
    const workspace = workspaceById.get(membership.workspace_id);
    if (!workspace) return;
    if (!window.confirm(`Cancel ${account.email}'s invitation to ${workspace.name}? The global BDB OS account will be retained.`)) return;
    await requestChange(
      "POST",
      { action: "cancel-invitation", workspaceId: workspace.id, userId: account.id },
      `membership-${workspace.id}`,
      `Invitation to ${workspace.name} cancelled.`,
    );
  }

  if (selectedAccount) {
    const isSelf = selectedAccount.id === actorUserId;
    const authSuspended = isAccountGloballySuspended(selectedAccount);
    const globallyProtected = isSelf || selectedAccount.is_platform_admin;

    return (
      <div className="founder-account-directory founder-account-profile">
        <button className="button button-quiet founder-account-profile-back" type="button" onClick={() => { setSelectedAccountId(null); setEditingIdentity(false); }}>
          <ArrowLeft size={15} /> Back to account directory
        </button>

        <section className="founder-account-profile-hero admin-panel">
          <span className="founder-account-profile-avatar">{(selectedAccount.full_name || selectedAccount.email).slice(0, 1).toUpperCase()}</span>
          <div className="founder-account-profile-title">
            <p className="eyebrow">Account Profile</p>
            <h2>{selectedAccount.full_name || "Name not recorded"}</h2>
            <p>{selectedAccount.email}</p>
          </div>
          <div className="founder-account-badges">
            <span className={authSuspended ? "badge badge-red" : "badge badge-green"}>{authSuspended ? "Sign-in suspended" : "Global sign-in active"}</span>
            {selectedAccount.email_confirmed_at
              ? <span className="badge badge-green"><CheckCircle2 size={12} /> Email verified</span>
              : <span className="badge badge-gold"><Clock3 size={12} /> Email unverified</span>}
            {selectedAccount.is_platform_admin && <span className="badge badge-gold"><ShieldCheck size={12} /> Platform admin</span>}
            {isSelf && <span className="badge">Your account</span>}
            {!selectedAccount.name_consistent && <span className="badge badge-red"><AlertTriangle size={12} /> Profile/Auth mismatch</span>}
          </div>
        </section>

        <div className="founder-account-profile-grid">
          <section className="admin-panel founder-account-profile-section">
            <div className="admin-section-heading">
              <h3>Identity</h3>
              <p>Global BDB OS identity. Changes here apply wherever this account is shown.</p>
            </div>
            {editingIdentity ? (
              <form className="founder-account-profile-edit" onSubmit={editIdentity}>
                <div className="field"><label>Full name</label><input name="fullName" defaultValue={selectedAccount.full_name} minLength={2} required /></div>
                <div className="field"><label>Email</label><input name="email" type="email" defaultValue={selectedAccount.email} required /></div>
                <div className="admin-form-actions">
                  <button className="button button-primary" disabled={busy === `identity-${selectedAccount.id}`}>
                    {busy === `identity-${selectedAccount.id}` ? <Loader2 className="spin" size={14} /> : <CheckCircle2 size={14} />} Save identity
                  </button>
                  <button className="button button-secondary" type="button" onClick={() => setEditingIdentity(false)}>Cancel</button>
                </div>
              </form>
            ) : (
              <>
                <div className="founder-account-profile-kv">
                  <span><small>Full name</small><strong>{selectedAccount.full_name || "Not recorded"}</strong></span>
                  <span><small>Email</small><strong>{selectedAccount.email}</strong></span>
                  <span><small>Email status</small><strong>{selectedAccount.email_confirmed_at ? "Verified" : "Unverified"}</strong></span>
                  <span><small>Account status</small><strong>{authSuspended ? "Suspended" : "Active"}</strong></span>
                  <span><small>Account created</small><strong>{formatMoment(selectedAccount.created_at)}</strong></span>
                  <span><small>Last sign-in</small><strong>{formatMoment(selectedAccount.last_sign_in_at)}</strong></span>
                  <span><small>Platform access</small><strong>{selectedAccount.is_platform_admin ? "Platform admin" : "Standard account"}</strong></span>
                  <span><small>Identity consistency</small><strong>{selectedAccount.name_consistent ? "Auth and profile agree" : "Needs review"}</strong></span>
                </div>
                <div className="admin-form-actions"><button className="button button-secondary" type="button" onClick={() => setEditingIdentity(true)}><Pencil size={14} /> Edit name or email</button></div>
              </>
            )}
          </section>

          <section className="admin-panel founder-account-profile-section">
            <div className="admin-section-heading">
              <h3>Global account controls</h3>
              <p>These actions affect this person's BDB OS sign-in, not a single business role.</p>
            </div>
            {globallyProtected ? (
              <div className="settings-note">
                <ShieldCheck size={18} />
                <strong>Protected platform account</strong>
                <p>{isSelf ? "Your own essential sign-in cannot be suspended or deleted from this screen." : "Active platform-admin sign-in is protected from global suspension or deletion."}</p>
              </div>
            ) : (
              <div className="founder-account-global-actions">
                <button className={authSuspended ? "button button-secondary" : "button button-danger"} disabled={busy === `auth-${selectedAccount.id}`} onClick={() => void changeAccountStatus(selectedAccount, authSuspended ? "active" : "suspended")}>
                  {busy === `auth-${selectedAccount.id}` ? <Loader2 className="spin" size={14} /> : authSuspended ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
                  {authSuspended ? "Restore sign-in everywhere" : "Suspend sign-in everywhere"}
                </button>
                {!selectedMemberships.length && (
                  <button className="button button-danger" disabled={busy === `delete-${selectedAccount.id}`} onClick={() => void deleteUnused(selectedAccount)}>
                    {busy === `delete-${selectedAccount.id}` ? <Loader2 className="spin" size={14} /> : <Trash2 size={14} />} Delete unused account
                  </button>
                )}
                {!!selectedMemberships.length && <p className="muted">Permanent account deletion is unavailable while business access or protected history exists.</p>}
              </div>
            )}
          </section>
        </div>

        <section className="admin-panel founder-account-profile-section">
          <div className="admin-section-heading">
            <h3>Business access</h3>
            <p>Every business linked to this global account. Detailed permissions remain under Clients → Users & Access.</p>
          </div>
          {!selectedMemberships.length && <div className="founder-account-profile-empty"><UserRound size={18} /> No business access.</div>}
          <div className="founder-account-business-list">
            {selectedMemberships.map((membership) => {
              const workspace = workspaceById.get(membership.workspace_id);
              if (!workspace) return null;
              const invitationState = invitationDeliveryState({
                membershipStatus: membership.status,
                deliveryStatus: membership.invitation_delivery_status,
                expiresAt: membership.invitation_expires_at,
              });
              const retryAfter = invitationCooldownSeconds(membership.invitation_delivery_attempted_at);
              const membershipBusy = busy === `membership-${workspace.id}`;
              return (
                <article className="founder-account-business-row" key={`${workspace.id}-${selectedAccount.id}`}>
                  <div className="founder-account-business-main">
                    <span className="founder-account-business-icon"><BriefcaseBusiness size={17} /></span>
                    <span>
                      <strong>{workspace.name}</strong>
                      <small>{profileLabels[membership.access_profile] ?? membership.access_profile} · {membership.status}</small>
                    </span>
                  </div>
                  <div className="founder-account-business-state">
                    <span className={stateClass(invitationState)}>{invitationLabels[invitationState]}</span>
                    {membership.status === "invited" && <small>Last sent: {formatMoment(membership.invitation_last_sent_at)}</small>}
                  </div>
                  <div className="founder-account-business-actions">
                    <button className="button button-secondary" type="button" onClick={() => onOpenBusiness(workspace.id)}>Open Users & Access <ChevronRight size={14} /></button>
                    {membership.status === "invited" ? (
                      <>
                        <button className="button button-secondary" type="button" disabled={membershipBusy || retryAfter > 0 || globallyProtected} onClick={() => void resendInvitation(selectedAccount, membership)}>
                          {membershipBusy ? <Loader2 className="spin" size={14} /> : <MailPlus size={14} />} {retryAfter > 0 ? `Resend in ${retryAfter}s` : "Resend invitation"}
                        </button>
                        <button className="button button-danger" type="button" disabled={membershipBusy || globallyProtected} onClick={() => void cancelInvitation(selectedAccount, membership)}><XCircle size={14} /> Cancel invitation</button>
                      </>
                    ) : (
                      <button className="button button-danger" type="button" disabled={membershipBusy || globallyProtected} onClick={() => void removeMembership(selectedAccount, membership)}><UserMinus size={14} /> Remove from business</button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className="founder-account-directory">
      <div className="admin-section-heading">
        <h2>Account directory</h2>
        <p>Global BDB OS user register. Open a person to review and manage their account across the platform.</p>
      </div>

      <div className="founder-account-directory-toolbar">
        <label className="founder-account-search"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email or business" aria-label="Search account directory" /></label>
        <div className="founder-account-directory-filters" aria-label="Account directory filters">
          {filters.map((item) => <button type="button" key={item.key} className={filter === item.key ? "active" : ""} onClick={() => setFilter(item.key)}>{item.label}</button>)}
        </div>
      </div>

      <div className="founder-account-register" role="table" aria-label="BDB OS accounts">
        <div className="founder-account-register-row founder-account-register-head" role="row">
          <span role="columnheader">Full name</span>
          <span role="columnheader">Email</span>
          <span role="columnheader">Business access</span>
          <span role="columnheader">Account status</span>
          <span role="columnheader">Email status</span>
          <span role="columnheader">Last sign-in</span>
          <span aria-hidden="true" />
        </div>
        {!visibleAccounts.length && <div className="founder-account-register-empty">No accounts match this search or filter.</div>}
        {visibleAccounts.map((account) => {
          const accountMemberships = memberships.filter((membership) => membership.user_id === account.id);
          const businessNames = accountMemberships.map((membership) => workspaceById.get(membership.workspace_id)?.name ?? "Unknown business");
          const authSuspended = isAccountGloballySuspended(account);
          return (
            <button type="button" className="founder-account-register-row" role="row" key={account.id} onClick={() => { setSelectedAccountId(account.id); setEditingIdentity(false); }}>
              <span className="founder-account-register-name" role="cell"><i>{(account.full_name || account.email).slice(0, 1).toUpperCase()}</i><strong>{account.full_name || "Name not recorded"}</strong>{account.is_platform_admin && <ShieldCheck size={13} aria-label="Platform admin" />}{!account.name_consistent && <AlertTriangle size={13} aria-label="Identity mismatch" />}</span>
              <span role="cell">{account.email}</span>
              <span role="cell">{businessNames.length ? businessNames.join(", ") : "None"}</span>
              <span role="cell"><b className={authSuspended ? "status-dot suspended" : "status-dot active"} />{authSuspended ? "Suspended" : "Active"}</span>
              <span role="cell">{account.email_confirmed_at ? "Verified" : "Unverified"}</span>
              <span role="cell">{formatMoment(account.last_sign_in_at)}</span>
              <span className="founder-account-register-open" aria-hidden="true"><ChevronRight size={15} /></span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
