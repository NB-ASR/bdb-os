import assert from "node:assert/strict";
import test from "node:test";
import {
  businessNamesForAccount,
  filterAccountDirectory,
  isAccountGloballySuspended,
  type AccountDirectoryAccount,
  type AccountDirectoryMembership,
  type AccountDirectoryWorkspace,
} from "../../src/lib/founder-account-directory.ts";

const now = new Date("2026-08-29T12:00:00.000Z");
const accounts: AccountDirectoryAccount[] = [
  {
    id: "owner-a",
    full_name: "Alice Owner",
    email: "alice@example.com",
    email_confirmed_at: "2026-08-20T10:00:00.000Z",
    banned_until: null,
    is_platform_admin: false,
    name_consistent: true,
  },
  {
    id: "suspended-b",
    full_name: "Bob Suspended",
    email: "bob@example.com",
    email_confirmed_at: "2026-08-20T10:00:00.000Z",
    banned_until: "2099-01-01T00:00:00.000Z",
    is_platform_admin: false,
    name_consistent: true,
  },
  {
    id: "platform-c",
    full_name: "Carol Platform",
    email: "carol@example.com",
    email_confirmed_at: "2026-08-20T10:00:00.000Z",
    banned_until: null,
    is_platform_admin: true,
    name_consistent: true,
  },
  {
    id: "orphan-d",
    full_name: "Dylan Orphan",
    email: "dylan@example.com",
    email_confirmed_at: null,
    banned_until: null,
    is_platform_admin: false,
    name_consistent: false,
  },
];

const workspaces: AccountDirectoryWorkspace[] = [
  { id: "workspace-a", name: "Vanita" },
  { id: "workspace-b", name: "BDB OS" },
];

const memberships: AccountDirectoryMembership[] = [
  {
    workspace_id: "workspace-a",
    user_id: "owner-a",
    status: "active",
    invitation_delivery_status: null,
    invitation_expires_at: null,
  },
  {
    workspace_id: "workspace-b",
    user_id: "owner-a",
    status: "active",
    invitation_delivery_status: null,
    invitation_expires_at: null,
  },
  {
    workspace_id: "workspace-a",
    user_id: "suspended-b",
    status: "active",
    invitation_delivery_status: null,
    invitation_expires_at: null,
  },
  {
    workspace_id: "workspace-b",
    user_id: "platform-c",
    status: "invited",
    invitation_delivery_status: "failed",
    invitation_expires_at: "2026-08-29T13:00:00.000Z",
  },
];

test("account directory search includes name, email and business names", () => {
  assert.deepEqual(
    filterAccountDirectory(accounts, memberships, workspaces, "Vanita", "all", now).map((account) => account.id),
    ["owner-a", "suspended-b"],
  );
  assert.deepEqual(
    filterAccountDirectory(accounts, memberships, workspaces, "carol@example.com", "all", now).map((account) => account.id),
    ["platform-c"],
  );
});

test("account directory shows all businesses for one global account", () => {
  assert.deepEqual(businessNamesForAccount("owner-a", memberships, workspaces), ["BDB OS", "Vanita"]);
});

test("account directory filters global status and ownership cases", () => {
  assert.equal(isAccountGloballySuspended(accounts[1], now), true);
  assert.deepEqual(
    filterAccountDirectory(accounts, memberships, workspaces, "", "suspended", now).map((account) => account.id),
    ["suspended-b"],
  );
  assert.deepEqual(
    filterAccountDirectory(accounts, memberships, workspaces, "", "platform-admins", now).map((account) => account.id),
    ["platform-c"],
  );
  assert.deepEqual(
    filterAccountDirectory(accounts, memberships, workspaces, "", "no-business", now).map((account) => account.id),
    ["orphan-d"],
  );
});

test("pending and inconsistent accounts are grouped as problem accounts", () => {
  assert.deepEqual(
    filterAccountDirectory(accounts, memberships, workspaces, "", "problems", now).map((account) => account.id),
    ["platform-c", "orphan-d"],
  );
});
