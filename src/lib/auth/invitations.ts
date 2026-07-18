export const MAX_INVITATION_TTL_SECONDS = 86_400;
export const DEFAULT_INVITATION_TTL_SECONDS = 86_400;
const MIN_INVITATION_TTL_SECONDS = 300;

export function invitationTtlSeconds(value = process.env.BDB_INVITATION_TTL_SECONDS) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) return DEFAULT_INVITATION_TTL_SECONDS;
  return Math.min(MAX_INVITATION_TTL_SECONDS, Math.max(MIN_INVITATION_TTL_SECONDS, parsed));
}

export function invitationExpiresAt(now = new Date(), ttlSeconds = invitationTtlSeconds()) {
  return new Date(now.getTime() + ttlSeconds * 1_000).toISOString();
}

export function publicAppOrigin(requestUrl: string, configured = process.env.NEXT_PUBLIC_APP_URL) {
  const candidate = configured?.trim() || new URL(requestUrl).origin;
  const parsed = new URL(candidate);

  if (!/^https?:$/.test(parsed.protocol)) throw new Error("INVALID_PUBLIC_APP_URL");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("INVALID_PUBLIC_APP_URL");
  }
  if (parsed.pathname !== "/") throw new Error("INVALID_PUBLIC_APP_URL");
  if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
    throw new Error("INSECURE_PUBLIC_APP_URL");
  }

  return parsed.origin;
}

export function activationRedirectUrl(requestUrl: string) {
  return `${publicAppOrigin(requestUrl)}/auth/callback?next=/activate`;
}
