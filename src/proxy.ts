import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const protectedRoutes = [
  "/workspace",
  "/accounts",
  "/customers",
  "/calendar",
  "/communications",
  "/documents",
  "/banking",
  "/reports",
  "/automation-hub",
  "/activity",
  "/settings",
  "/team",
  "/admin",
  "/activate",
  "/change-password",
];
const featureRoutes: Record<string, string> = {
  "/workspace": "overview",
  "/accounts": "accounts",
  "/customers": "customers",
  "/calendar": "calendar",
  "/communications": "communications",
  "/documents": "documents",
  "/banking": "banking",
  "/reports": "reports",
  "/automation-hub": "automation",
  "/activity": "activity",
  "/settings": "appearance",
  "/team": "team_members",
};

export async function proxy(request: NextRequest) {
  const hostname = request.headers.get("host")?.split(":")[0].toLowerCase() ?? "";
  const effectivePath = hostname === "admin.bdb-os.com" && request.nextUrl.pathname === "/"
    ? "/admin"
    : hostname === "app.bdb-os.com" && request.nextUrl.pathname === "/"
      ? "/workspace"
      : request.nextUrl.pathname;
  const responseUrl = request.nextUrl.clone();
  responseUrl.pathname = effectivePath;
  const nextResponse = () => effectivePath === request.nextUrl.pathname
    ? NextResponse.next({ request })
    : NextResponse.rewrite(responseUrl);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) return nextResponse();

  let response = nextResponse();
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(items) {
        items.forEach(({ name, value }) => request.cookies.set(name, value));
        response = nextResponse();
        items.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims as { sub?: string; aal?: string } | undefined;
  const requiresAuth = protectedRoutes.some((route) => effectivePath === route || effectivePath.startsWith(`${route}/`));
  if (requiresAuth && !claims?.sub) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", effectivePath);
    return NextResponse.redirect(login);
  }
  if (!claims?.sub) return response;

  const { data: profile } = await supabase
    .from("profiles")
    .select("must_change_password,active_workspace_id")
    .eq("id", claims.sub)
    .maybeSingle();
  if (profile?.must_change_password && effectivePath !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  if (effectivePath.startsWith("/admin")) {
    if (claims.aal !== "aal2") {
      return NextResponse.redirect(new URL("/mfa", request.url));
    }
    const { data: platformAdmin } = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", claims.sub)
      .eq("active", true)
      .maybeSingle();
    if (!platformAdmin) return NextResponse.redirect(new URL("/workspace", request.url));
    return response;
  }

  if (["/activate", "/change-password"].includes(effectivePath)) return response;

  const route = Object.keys(featureRoutes).find((item) => effectivePath === item || effectivePath.startsWith(`${item}/`));
  if (!route) return response;

  const requestedFeature = featureRoutes[route];
  // The database-backed profile is authoritative. A stale cookie must never move
  // a request into an unrelated workspace.
  const preferredWorkspace = profile?.active_workspace_id ?? request.cookies.get("bdb-workspace")?.value ?? undefined;
  let membershipQuery = supabase
    .from("workspace_memberships")
    .select("workspace_id,role,access_profile,workspaces!inner(plan_id,status)")
    .eq("user_id", claims.sub)
    .eq("status", "active");
  if (preferredWorkspace) membershipQuery = membershipQuery.eq("workspace_id", preferredWorkspace);
  const { data: memberships } = await membershipQuery.limit(1);
  const membership = memberships?.[0] as {
    workspace_id: string;
    role: string;
    access_profile: string;
    workspaces: { plan_id: string | null; status: string };
  } | undefined;
  if (!membership) return NextResponse.redirect(new URL("/no-workspace", request.url));
  if (["suspended", "cancelled"].includes(membership.workspaces.status)) {
    return NextResponse.redirect(new URL("/workspace-suspended", request.url));
  }

  const now = new Date().toISOString();
  const [{ data: planFeature }, { data: override }] = await Promise.all([
    membership.workspaces.plan_id
      ? supabase.from("plan_features").select("enabled").eq("plan_id", membership.workspaces.plan_id).eq("feature_key", requestedFeature).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase
      .from("workspace_feature_overrides")
      .select("enabled")
      .eq("workspace_id", membership.workspace_id)
      .eq("feature_key", requestedFeature)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .maybeSingle(),
  ]);
  const ownerTeamAccess = requestedFeature === "team_members" && membership.access_profile === "owner";
  if (!ownerTeamAccess && !(override?.enabled ?? planFeature?.enabled ?? false)) {
    const unavailable = new URL("/feature-unavailable", request.url);
    unavailable.searchParams.set("feature", requestedFeature);
    return NextResponse.redirect(unavailable);
  }

  if (!preferredWorkspace) {
    response.cookies.set("bdb-workspace", membership.workspace_id, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
