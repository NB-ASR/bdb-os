import fs from "node:fs";

const dashboardRoute = fs.readFileSync("src/app/api/admin/route.ts", "utf8");
const accountsRoute = fs.readFileSync("src/app/api/admin/accounts/route.ts", "utf8");
const adminAuth = fs.readFileSync("src/lib/admin-auth.ts", "utf8");
const founderHelpers = fs.readFileSync("src/lib/founder-admin.ts", "utf8");
const invitations = fs.readFileSync("src/lib/server/founder-admin-invitations.ts", "utf8");
const adminPage = fs.readFileSync("src/app/admin/page.tsx", "utf8");
const accountPanel = fs.readFileSync("src/components/founder-account-workspaces.tsx", "utf8");
const accountDirectory = fs.readFileSync("src/components/founder-account-directory.tsx", "utf8");
const accountDirectoryHelpers = fs.readFileSync("src/lib/founder-account-directory.ts", "utf8");
const migration = fs.readFileSync("supabase/migrations/20260828150126_founder_admin_v1_repair.sql", "utf8");
const identityRepair = fs.readFileSync("scripts/repair-founder-identity-names.mjs", "utf8");

function assert(source, pattern, message) {
  if (!pattern.test(source)) throw new Error(message);
}

for (const pattern of [
  /email_confirmed_at:/,
  /last_sign_in_at:/,
  /is_platform_admin:/,
  /actorUserId:/,
  /profile_full_name:/,
  /auth_full_name:/,
  /name_consistent:/,
]) assert(dashboardRoute, pattern, `Founder Admin account DTO contract missing: ${pattern}`);
if (/identities\s*:/.test(dashboardRoute)) throw new Error("Founder Admin must not expose raw Auth identities.");

for (const pattern of [
  /requirePlatformAdmin\(\)/,
  /createAdminClient\(\)/,
  /ensureFounderManagedUser/,
  /attemptFounderInvitationDelivery/,
  /from\("workspace_memberships"\)/,
  /LAST_OWNER/,
  /SELF_PRIVILEGE_CHANGE/,
  /updateUserById/,
  /action === "cancel-invitation"/,
  /action === "remove-membership"/,
  /action !== "delete-unused-account"/,
  /founder_unused_auth_user_preview/,
  /auth_account_retained: true/,
  /previous:/,
  /new:/,
]) assert(accountsRoute, pattern, `Founder user-management contract missing: ${pattern}`);

const prepareCustomPermissions = accountsRoute.indexOf("await copyCustomPermissions(admin, workspaceId, targetUserId");
const updateMembership = accountsRoute.indexOf('.from("workspace_memberships")\n      .update(changes)');
const cleanStandardPermissions = accountsRoute.indexOf('if (effectiveProfile !== "custom")');
if (!(prepareCustomPermissions > -1 && updateMembership > prepareCustomPermissions && cleanStandardPermissions > updateMembership)) {
  throw new Error("Founder Admin must prepare custom permissions before profile activation and clean standard-profile overrides afterwards.");
}

for (const pattern of [
  /firstAvailableSlug/,
  /DUPLICATE_WORKSPACE_SLUG/,
  /suggestedSlug/,
  /setupComplete/,
  /workspace-profile/,
  /archive-workspace/,
  /workspace-deletion-preview/,
  /founder_delete_empty_workspace/,
  /previous/,
  /new:/,
]) assert(dashboardRoute, pattern, `Founder business-management contract missing: ${pattern}`);

assert(founderHelpers, /over_email_send_rate_limit/, "Supabase email rate limiting must be classified.");
assert(founderHelpers, /status: 429/, "Email rate limiting must preserve HTTP 429.");
assert(adminAuth, /AdminProductError/, "Founder Admin must expose typed product errors.");
assert(adminAuth, /UNEXPECTED_ADMIN_ERROR/, "Only unexpected faults should use the generic server boundary.");
assert(invitations, /invitation_delivery_status: "failed"/, "Failed invitation delivery must be persisted.");
assert(invitations, /invitation_delivery_status: "sent"/, "Successful invitation delivery must be persisted.");

for (const label of [
  "Business Profile",
  "Users & Access",
  "Plan & Modules",
  "Usage",
  "Billing",
  "Branding",
  "Danger Zone",
]) assert(adminPage, new RegExp(label.replace("&", "&")), `Business-first navigation missing ${label}.`);
assert(adminPage, /Advanced[\s\S]*Account Directory/, "Global account diagnostics must remain secondary.");
assert(adminPage, /Workspace address[\s\S]*Changing this can affect saved links/, "Slug editing must warn about saved URLs.");
assert(adminPage, /type the exact business name|Type <strong>/i, "Permanent deletion must require typed-name confirmation.");
assert(adminPage, /FounderAccountDirectory[\s\S]*onOpenBusiness=\{openAccountBusiness\}/, "Account profiles must jump to the canonical business Users & Access screen.");
assert(adminPage, /openAccountBusiness[\s\S]*setClientSection\("users"\)[\s\S]*setTab\("clients"\)/, "Account-to-business navigation must reuse Clients → Users & Access.");

for (const pattern of [
  /workspace={activeWorkspace}/,
  /Invite a person/,
  /Invitation sent/,
  /Invitation pending/,
  /Invitation expired/,
  /Invitation failed/,
  /Resend invitation/,
  /Cancel invitation/,
  /Edit name or email/,
  /Remove from business/,
  /Delete unused account/,
  /Email verified/,
  /Name mismatch/,
]) assert(`${adminPage}\n${accountPanel}\n${accountDirectory}`, pattern, `Business user workflow missing: ${pattern}`);

for (const label of [
  "Full name",
  "Email",
  "Business access",
  "Account status",
  "Email status",
  "Last sign-in",
  "Account Profile",
  "Global account controls",
  "Open Users & Access",
  "Platform Admins",
  "No Business Access",
  "Pending / Problems",
]) assert(accountDirectory, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), `Account Directory V1 missing ${label}.`);

for (const pattern of [
  /filterAccountDirectory/,
  /isAccountGloballySuspended/,
  /action: "edit-user"/,
  /action: "account-auth-status"/,
  /action: "resend-invitation"/,
  /action: "cancel-invitation"/,
  /action: "remove-membership"/,
  /action: "delete-unused-account"/,
  /globallyProtected/,
  /selectedAccount\.is_platform_admin/,
]) assert(accountDirectory, pattern, `Global Account Profile contract missing: ${pattern}`);

for (const pattern of [
  /AccountDirectoryFilter/,
  /businessNamesForAccount/,
  /name_consistent/,
  /email_confirmed_at/,
  /platform-admins/,
  /no-business/,
  /problems/,
]) assert(accountDirectoryHelpers, pattern, `Account Directory filter model missing: ${pattern}`);

for (const pattern of [
  /invitation_delivery_status/,
  /invitation_delivery_attempted_at/,
  /founder_workspace_deletion_preview/,
  /protected_financial_records/,
  /founder_delete_empty_workspace/,
  /CONFIRMATION_MISMATCH/,
  /DELETION_BLOCKED/,
  /founder_unused_auth_user_preview/,
  /grant execute[\s\S]*service_role/,
  /revoke all[\s\S]*authenticated/,
]) assert(migration, pattern, `Founder Admin migration safety contract missing: ${pattern}`);

assert(identityRepair, /nicholasbianchini10@gmail\.com[\s\S]*Nicholas Bianchini/, "Nicholas identity repair mapping is incorrect.");
assert(identityRepair, /matdem553@gmail\.com[\s\S]*Matthew Demicoli/, "Matthew identity repair mapping is incorrect.");
assert(identityRepair, /updateUserById/, "Identity repair must use the supported Supabase Auth Admin API.");
assert(identityRepair, /from\("profiles"\)/, "Identity repair must keep public profiles coherent.");
if (/Founder Admin data could not be loaded/.test(`${dashboardRoute}\n${accountsRoute}\n${adminAuth}`)) {
  throw new Error("Mutation errors must not use the obsolete Founder Admin data-loading failure message.");
}

console.log("Founder Admin V1 business/user safety contract checks passed.");
