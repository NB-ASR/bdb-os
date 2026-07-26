import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { devIdentityEmail, evaluateDevAccess } from "@/lib/dev-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

const DEVELOPMENT_USERS = [
  {
    view: "admin" as const,
    id: "705f95d2-8d02-4873-a2f1-a3b405b175c4",
    passwordField: "adminPassword" as const,
  },
  {
    view: "workspace" as const,
    id: "3e3a93f9-5848-4c08-854a-0429e6d8e19e",
    passwordField: "workspacePassword" as const,
  },
];

type SetupRequest = {
  token?: unknown;
  adminPassword?: unknown;
  workspacePassword?: unknown;
};

function response(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: NO_STORE_HEADERS });
}

function configuredSetupToken() {
  const token = process.env.BDB_DEV_PASSWORD_SETUP_TOKEN?.trim();
  return token && token.length >= 32 ? token : null;
}

function secureTokenMatch(provided: string, expected: string) {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

function validatePassword(value: unknown, label: string) {
  if (typeof value !== "string") return `${label} is required.`;
  if (value.length < MIN_PASSWORD_LENGTH) return `${label} must contain at least ${MIN_PASSWORD_LENGTH} characters.`;
  if (value.length > MAX_PASSWORD_LENGTH) return `${label} must contain no more than ${MAX_PASSWORD_LENGTH} characters.`;
  return null;
}

function setupAvailability() {
  const devAccess = evaluateDevAccess();
  if (!devAccess.enabled) {
    return { enabled: false, reason: devAccess.reason ?? "Development access is unavailable." };
  }

  if (!configuredSetupToken()) {
    return { enabled: false, reason: "The one-time password setup token is not configured." };
  }

  return { enabled: true, reason: null };
}

export async function GET() {
  const availability = setupAvailability();
  return response(availability, availability.enabled ? 200 : 404);
}

export async function POST(request: Request) {
  const availability = setupAvailability();
  if (!availability.enabled) return response(availability, 404);

  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) {
    return response({ error: "Cross-origin password setup is blocked." }, 403);
  }

  if (!request.headers.get("content-type")?.toLowerCase().includes("application/json")) {
    return response({ error: "A JSON request body is required." }, 415);
  }

  const body = (await request.json().catch(() => null)) as SetupRequest | null;
  if (!body || typeof body.token !== "string") {
    return response({ error: "The one-time setup token is required." }, 400);
  }

  const expectedToken = configuredSetupToken();
  if (!expectedToken || !secureTokenMatch(body.token, expectedToken)) {
    return response({ error: "The one-time setup token is invalid." }, 403);
  }

  const adminPasswordError = validatePassword(body.adminPassword, "Administrator password");
  const workspacePasswordError = validatePassword(body.workspacePassword, "Workspace password");
  if (adminPasswordError || workspacePasswordError) {
    return response({ error: adminPasswordError ?? workspacePasswordError }, 400);
  }

  const adminPassword = body.adminPassword as string;
  const workspacePassword = body.workspacePassword as string;
  if (adminPassword === workspacePassword) {
    return response({ error: "Use different passwords for the administrator and workspace identities." }, 400);
  }

  const admin = createAdminClient();
  if (!admin) return response({ error: "Supabase administration is not configured for this Preview." }, 503);

  const identityChecks = await Promise.all(
    DEVELOPMENT_USERS.map(async (target) => {
      const expectedEmail = devIdentityEmail(target.view);
      if (!expectedEmail) throw new Error(`${target.view} development email is not configured.`);

      const { data, error } = await admin.auth.admin.getUserById(target.id);
      if (error || !data.user) throw new Error(`Could not verify the ${target.view} development identity.`);
      if (data.user.email?.trim().toLowerCase() !== expectedEmail) {
        throw new Error(`The ${target.view} user ID does not match the configured development email.`);
      }

      return { ...target, expectedEmail };
    }),
  ).catch((error: unknown) => {
    console.error("Development password identity verification failed", error);
    return null;
  });

  if (!identityChecks) {
    return response({ error: "The development identities could not be verified. No passwords were changed." }, 409);
  }

  const passwords = { adminPassword, workspacePassword };
  const updateResults = await Promise.all(
    identityChecks.map(async (target) => {
      const { data, error } = await admin.auth.admin.updateUserById(target.id, {
        password: passwords[target.passwordField],
      });
      if (error || !data.user) throw new Error(`Could not update ${target.expectedEmail}.`);
      return data.user.email;
    }),
  ).catch((error: unknown) => {
    console.error("Development password update failed", error);
    return null;
  });

  if (!updateResults) {
    return response(
      {
        error: "At least one password update failed. Verify both identities before storing either password in Vercel.",
      },
      500,
    );
  }

  return response({
    ok: true,
    updated: updateResults,
    next: "Store both passwords as branch-scoped Sensitive Vercel variables, then remove this setup route and token.",
  });
}
