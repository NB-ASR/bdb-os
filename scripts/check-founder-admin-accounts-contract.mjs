import fs from "node:fs";

const dashboardRoute = fs.readFileSync("src/app/api/admin/route.ts", "utf8");
const accountsRoute = fs.readFileSync("src/app/api/admin/accounts/route.ts", "utf8");
const adminPage = fs.readFileSync("src/app/admin/page.tsx", "utf8");
const accountPanel = fs.readFileSync("src/components/founder-account-workspaces.tsx", "utf8");

function assert(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

assert(dashboardRoute, /email_confirmed_at:/, "Founder Admin account DTO must expose email verification state.");
assert(dashboardRoute, /last_sign_in_at:/, "Founder Admin account DTO must expose last sign-in time.");
assert(dashboardRoute, /is_platform_admin:/, "Founder Admin account DTO must identify platform admins.");
assert(dashboardRoute, /actorUserId:/, "Founder Admin must identify the current actor so self-edit controls can be locked.");
assert(dashboardRoute, /Activate this workspace after at least one Owner has accepted/, "Workspaces must not become active without an active Owner.");
if (/identities\s*:/.test(dashboardRoute)) throw new Error("Founder Admin must not expose raw Auth identities.");

for (const pattern of [
  /requirePlatformAdmin\(\)/,
  /createAdminClient\(\)/,
  /inviteUserByEmail/,
  /from\("workspace_memberships"\)/,
  /\.eq\("workspace_id", workspaceId\)/,
  /LAST_OWNER/,
  /SELF_PRIVILEGE_CHANGE/,
  /writeAudit\(/,
]) {
  assert(accountsRoute, pattern, `Founder account route is missing security contract: ${pattern}`);
}
if (/body\.action\s*===\s*["']delete/.test(accountsRoute)) {
  throw new Error("Founder Admin must not expose destructive Auth account deletion.");
}

assert(adminPage, /Accounts & Workspaces/, "Founder Admin navigation must expose Accounts & Workspaces.");
assert(adminPage, /FounderAccountWorkspaces/, "Founder Admin must render the account/workspace panel.");
assert(accountPanel, /\/api\/admin\/accounts/, "Account panel must use the MFA-protected Founder Admin route.");
assert(accountPanel, /Invite account/, "Account panel must support workspace invitations.");
assert(accountPanel, /No workspace access/, "Account panel must surface unassigned Auth accounts.");
assert(accountPanel, /Email verified/, "Account panel must surface email verification state.");

console.log("Founder Admin account/workspace contract checks passed.");
