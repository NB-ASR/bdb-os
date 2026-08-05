const MANUAL_LOGIN_DOMAIN = "manual.bdb.invalid";

export function normaliseManualLoginId(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[._-]+|[._-]+$/g, "");
}

export function manualOwnerEmail(workspaceSlug: string, loginId: string) {
  const slug = normaliseManualLoginId(workspaceSlug);
  const login = normaliseManualLoginId(loginId);
  if (slug.length < 3 || login.length < 3) throw new Error("INVALID_MANUAL_LOGIN");
  return `${login}.${slug}@${MANUAL_LOGIN_DOMAIN}`;
}

export function validateTemporaryPassword(value: unknown) {
  const password = String(value ?? "");
  if (password.length < 12) return "Temporary password must contain at least 12 characters.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Temporary password must include uppercase, lowercase and numeric characters.";
  }
  return null;
}

export const manualLoginDomain = MANUAL_LOGIN_DOMAIN;
