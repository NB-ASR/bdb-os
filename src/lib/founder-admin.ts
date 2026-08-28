export const INVITATION_RESEND_COOLDOWN_SECONDS = 60;

export type InvitationDeliveryState =
  | "sent"
  | "pending"
  | "expired"
  | "failed"
  | "active"
  | "suspended";

type InvitationStateInput = {
  membershipStatus: string;
  deliveryStatus?: string | null;
  expiresAt?: string | null;
  now?: Date;
};

export type FounderErrorSpec = {
  code: string;
  status: number;
  message: string;
};

function errorRecord(error: unknown) {
  return error && typeof error === "object"
    ? error as Record<string, unknown>
    : null;
}

export function cleanBusinessSlug(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 63)
    .replace(/-$/g, "");
}

export function slugCandidate(base: string, suffix = 1) {
  const clean = cleanBusinessSlug(base) || "business";
  if (suffix <= 1) return clean.slice(0, 63).replace(/-$/g, "");
  const ending = `-${suffix}`;
  return `${clean.slice(0, 63 - ending.length).replace(/-$/g, "")}${ending}`;
}

export function firstAvailableSlug(base: string, unavailable: Iterable<string>) {
  const taken = new Set(Array.from(unavailable, (item) => item.toLowerCase()));
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const candidate = slugCandidate(base, suffix);
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error("SLUG_SUGGESTION_EXHAUSTED");
}

export function invitationDeliveryState({
  membershipStatus,
  deliveryStatus,
  expiresAt,
  now = new Date(),
}: InvitationStateInput): InvitationDeliveryState {
  if (membershipStatus === "active") return "active";
  if (membershipStatus === "suspended") return "suspended";
  if (deliveryStatus === "failed") return "failed";
  if (deliveryStatus === "pending") return "pending";
  if (expiresAt) {
    const expiry = new Date(expiresAt);
    if (!Number.isNaN(expiry.getTime()) && expiry.getTime() <= now.getTime()) return "expired";
  }
  return "sent";
}

export function invitationCooldownSeconds(
  attemptedAt: string | null | undefined,
  now = new Date(),
) {
  if (!attemptedAt) return 0;
  const attempted = new Date(attemptedAt);
  if (Number.isNaN(attempted.getTime())) return 0;
  const elapsedSeconds = Math.floor((now.getTime() - attempted.getTime()) / 1_000);
  return Math.max(0, INVITATION_RESEND_COOLDOWN_SECONDS - elapsedSeconds);
}

export function classifyFounderAdminError(error: unknown): FounderErrorSpec | null {
  const record = errorRecord(error);
  const code = String(record?.code ?? "");
  const status = Number(record?.status ?? 0);
  const message = error instanceof Error
    ? error.message
    : String(record?.message ?? "");
  const details = String(record?.details ?? "");

  if (
    code === "over_email_send_rate_limit"
    || status === 429
    || /email rate limit exceeded/i.test(message)
  ) {
    return {
      code: "EMAIL_RATE_LIMIT",
      status: 429,
      message: "Email sending limit reached. The invitation was not sent. Try again shortly.",
    };
  }

  if (code === "email_address_not_authorized" || /email address not authorized/i.test(message)) {
    return {
      code: "EMAIL_DELIVERY_NOT_CONFIGURED",
      status: 503,
      message: "Production invitation email is not configured for this address. The invitation was saved and can be resent after email delivery is configured.",
    };
  }

  if (code === "email_exists" || code === "user_already_exists" || /already (been )?registered|email.*already exists/i.test(message)) {
    return {
      code: "AUTH_EMAIL_CONFLICT",
      status: 409,
      message: "That email address already belongs to another BDB OS account.",
    };
  }

  if (code === "validation_failed" || code === "invalid_email" || /invalid email/i.test(message)) {
    return {
      code: "INVALID_EMAIL",
      status: 400,
      message: "Enter a valid work email address.",
    };
  }

  if (code === "23505" && (/workspaces_slug_key/.test(message) || /\(slug\)/.test(details))) {
    return {
      code: "DUPLICATE_WORKSPACE_SLUG",
      status: 409,
      message: "That workspace address is already in use.",
    };
  }

  if (code === "23505" && /workspace_memberships/.test(`${message} ${details}`)) {
    return {
      code: "MEMBER_EXISTS",
      status: 409,
      message: "This person already has access or a pending invitation for that business.",
    };
  }

  return null;
}
