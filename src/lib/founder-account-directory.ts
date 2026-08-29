import { invitationDeliveryState } from "@/lib/founder-admin";

export type AccountDirectoryFilter =
  | "all"
  | "active"
  | "suspended"
  | "platform-admins"
  | "no-business"
  | "problems";

export type AccountDirectoryAccount = {
  id: string;
  email: string;
  full_name: string;
  email_confirmed_at: string | null;
  banned_until: string | null;
  is_platform_admin: boolean;
  name_consistent: boolean;
};

export type AccountDirectoryMembership = {
  workspace_id: string;
  user_id: string;
  status: string;
  invitation_delivery_status: string | null;
  invitation_expires_at: string | null;
};

export type AccountDirectoryWorkspace = {
  id: string;
  name: string;
};

export function isAccountGloballySuspended(
  account: Pick<AccountDirectoryAccount, "banned_until">,
  now = new Date(),
) {
  if (!account.banned_until) return false;
  const suspendedUntil = new Date(account.banned_until);
  return !Number.isNaN(suspendedUntil.getTime()) && suspendedUntil.getTime() > now.getTime();
}

export function accountHasPendingOrProblemState(
  account: AccountDirectoryAccount,
  memberships: AccountDirectoryMembership[],
  now = new Date(),
) {
  if (!account.name_consistent || !account.email_confirmed_at) return true;
  return memberships.some((membership) => {
    if (membership.status !== "invited") return false;
    const state = invitationDeliveryState({
      membershipStatus: membership.status,
      deliveryStatus: membership.invitation_delivery_status,
      expiresAt: membership.invitation_expires_at,
      now,
    });
    return ["pending", "failed", "expired", "sent"].includes(state);
  });
}

export function businessNamesForAccount(
  accountId: string,
  memberships: AccountDirectoryMembership[],
  workspaces: AccountDirectoryWorkspace[],
) {
  const workspaceNames = new Map(workspaces.map((workspace) => [workspace.id, workspace.name]));
  return memberships
    .filter((membership) => membership.user_id === accountId)
    .map((membership) => workspaceNames.get(membership.workspace_id) ?? "Unknown business")
    .sort((a, b) => a.localeCompare(b));
}

export function filterAccountDirectory(
  accounts: AccountDirectoryAccount[],
  memberships: AccountDirectoryMembership[],
  workspaces: AccountDirectoryWorkspace[],
  query: string,
  filter: AccountDirectoryFilter,
  now = new Date(),
) {
  const normalizedQuery = query.trim().toLowerCase();

  return accounts
    .filter((account) => {
      const accountMemberships = memberships.filter((membership) => membership.user_id === account.id);
      const businessNames = businessNamesForAccount(account.id, memberships, workspaces);
      const searchable = `${account.full_name} ${account.email} ${businessNames.join(" ")}`.toLowerCase();
      if (normalizedQuery && !searchable.includes(normalizedQuery)) return false;

      switch (filter) {
        case "active":
          return !isAccountGloballySuspended(account, now);
        case "suspended":
          return isAccountGloballySuspended(account, now);
        case "platform-admins":
          return account.is_platform_admin;
        case "no-business":
          return accountMemberships.length === 0;
        case "problems":
          return accountHasPendingOrProblemState(account, accountMemberships, now);
        default:
          return true;
      }
    })
    .sort((a, b) => (a.full_name || a.email).localeCompare(b.full_name || b.email));
}
