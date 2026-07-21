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

function serviceUnavailable() {
  return new NextResponse("BDB OS is temporarily unavailable. No workspace data has been loaded.", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
      "Content-Type": "text/plain; charset=utf-8",
      "Retry-After": "60",
    },
  });
}

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
  const requiresAuth = protectedRoutes.some((route) => effectivePath === route || effectivePath.startsWith(`${route}/`));
  const apiRoute = effectivePath.startsWith("/api/");

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    if (apiRoute) return nextResponse();
    return requiresAuth ? serviceUnavailable() : nextResponse();
  }

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

  const claimsResult = await supabase.auth.getClaims();
  const claims = claimsResult.data?.claims as { sub?: string; aal?: string } | undefined;

  if (apiRoute) return response;

  if (claimsResult.error && requiresAuth) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", effectivePath);
    login.searchParams.set("reason", "session-verification-failed");
    return NextResponse.redirect(login);
  }

  if (requiresAuth && !claims?.sub) {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", effectivePath);
    return NextResponse.redirect(login);
  }
  if (!claims?.sub) return response;

  const profileResult = await supabase
    .from("profiles")
    .select("must_change_password,active_workspace_id,is_active")
    .eq("id", claims.sub)
    .maybeSingle();
  if (profileResult.error) return serviceUnavailable();
  const profile = profileResult.data;
  if (profile && profile.is_active === false) return NextResponse.redirect(new URL("/workspace-suspended", request.url));
  if (profile?.must_change_password && effectivePath !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  if (effectivePath.startsWith("/admin")) {
    if (claims.aal !== "aal2") return NextResponse.redirect(new URL("/mfa", request.url));
    const adminResult = await supabase
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", claims.sub)
      .eq("active", true)
      .maybeSingle();
    if (adminResult.error) return serviceUnavailable();
    if (!adminResult.data) return NextResponse.redirect(new URL("/workspace", request.url));
    return response;
  }

  if (["/activate", "/change-password"].includes(effectivePath)) return response;

  const route = Object.keys(featureRoutes).find((item) => effectivePath === item || effectivePath.startsWith(`${item}/`));
  if (!route) return response;

  const requestedFeature = featureRoutes[route];
  const preferredWorkspace = profile?.active_workspace_id ?? request.cookies.get("bdb-workspace")?.value ?? undefined;
  let membershipQuery = supabase
    .from("workspace_memberships")
    .select("workspace_id,role,access_profile,workspaces!inner(plan_id,status)")
    .eq("user_id", claims.sub)
    .eq("status", "active");
  if (preferredWorkspace) membershipQuery = membershipQuery.eq("workspace_id", preferredWorkspace);
  const membershipResult = await membershipQuery.limit(1);
  if (membershipResult.error) return serviceUnavailable();
  const membership = membershipResult.data?.[0] as unknown as {
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
  const [planFeatureResult, overrideResult] = await Promise.all([
    membership.workspaces.plan_id
      ? supabase.from("plan_features").select("enabled").eq("plan_id", membership.workspaces.plan_id).eq("feature_key", requestedFeature).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("workspace_feature_overrides")
      .select("enabled")
      .eq("workspace_id", membership.workspace_id)
      .eq("feature_key", requestedFeature)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .maybeSingle(),
  ]);
  if (planFeatureResult.error || overrideResult.error) return serviceUnavailable();

  const ownerTeamAccess = requestedFeature === "team_members" && membership.access_profile === "owner";
  if (!ownerTeamAccess && !(overrideResult.data?.enabled ?? planFeatureResult.data?.enabled ?? false)) {
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
