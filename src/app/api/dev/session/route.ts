import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import {
  DEV_ACCESS_COOKIE,
  devIdentityEmail,
  evaluateDevAccess,
  isDevAccessView,
  matchesDevIdentity,
  type DevAccessView,
} from "@/lib/dev-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };
const SESSION_MAX_AGE = 60 * 60 * 12;

function credentials(view: DevAccessView) {
  return view === "admin"
    ? {
        email: process.env.BDB_DEV_ADMIN_EMAIL?.trim(),
        password: process.env.BDB_DEV_ADMIN_PASSWORD,
      }
    : {
        email: process.env.BDB_DEV_WORKSPACE_EMAIL?.trim(),
        password: process.env.BDB_DEV_WORKSPACE_PASSWORD,
      };
}

function unavailable(reason: string, status = 404) {
  return Response.json(
    { enabled: false, error: "DEV_ACCESS_UNAVAILABLE", reason },
    { status, headers: NO_STORE_HEADERS },
  );
}

export async function GET() {
  const status = evaluateDevAccess();
  if (!status.enabled) return unavailable(status.reason ?? "Development access is unavailable.");

  const cookieStore = await cookies();
  const storedView = cookieStore.get(DEV_ACCESS_COOKIE)?.value;
  return Response.json(
    {
      enabled: true,
      view: isDevAccessView(storedView) ? storedView : null,
      adminConfigured: Boolean(credentials("admin").email && credentials("admin").password),
      workspaceConfigured: Boolean(credentials("workspace").email && credentials("workspace").password),
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function POST(request: Request) {
  const status = evaluateDevAccess();
  if (!status.enabled) return unavailable(status.reason ?? "Development access is unavailable.");

  const body = (await request.json().catch(() => null)) as { view?: unknown } | null;
  if (!isDevAccessView(body?.view)) {
    return Response.json({ error: "Choose the Admin or Workspace view." }, { status: 400, headers: NO_STORE_HEADERS });
  }

  const view = body.view;
  const account = credentials(view);
  if (!account.email || !account.password) {
    return Response.json(
      { error: `${view === "admin" ? "Admin" : "Workspace"} development credentials are not configured.` },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const supabase = await createClient();
  if (!supabase) return unavailable("Supabase is not configured for this preview.", 503);

  await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
  const { data, error } = await supabase.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (error || !data.user || !matchesDevIdentity(view, data.user.email)) {
    console.error("Development session could not be created", error);
    return Response.json(
      { error: "The seeded development account could not be opened." },
      { status: 401, headers: NO_STORE_HEADERS },
    );
  }

  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === "production";
  cookieStore.set(DEV_ACCESS_COOKIE, view, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });

  if (view === "workspace") {
    const workspaceId = process.env.BDB_DEV_WORKSPACE_ID?.trim();
    if (workspaceId) {
      cookieStore.set("bdb-workspace", workspaceId, {
        httpOnly: true,
        sameSite: "lax",
        secure,
        path: "/",
        maxAge: SESSION_MAX_AGE,
      });
    }
  } else {
    cookieStore.delete("bdb-workspace");
  }

  return Response.json(
    {
      ok: true,
      view,
      email: devIdentityEmail(view),
      redirect: view === "admin" ? "/admin" : "/workspace",
    },
    { headers: NO_STORE_HEADERS },
  );
}

export async function DELETE() {
  const status = evaluateDevAccess();
  if (!status.enabled) return unavailable(status.reason ?? "Development access is unavailable.");

  const supabase = await createClient();
  await supabase?.auth.signOut({ scope: "local" }).catch(() => undefined);
  const cookieStore = await cookies();
  cookieStore.delete(DEV_ACCESS_COOKIE);
  cookieStore.delete("bdb-workspace");
  return Response.json({ ok: true }, { headers: NO_STORE_HEADERS });
}
