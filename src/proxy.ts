import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import {
  DEV_ACCESS_COOKIE,
  evaluateDevAccess,
  isDevAccessView,
  matchesDevIdentity,
} from "@/lib/dev-access";

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

type SupportSession = {
  workspace_id: string;
  access_mode: string;
  expires_at: string;
};

type WorkspaceAccess = {
  workspace_id: string;
  role: string;
  access_profile: string;
  workspaces: { plan_id: string | null; status: string };
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

function accessRedirect(request: NextRequest, effectivePath: string, reason?: string) {
  const target = request.nextUrl.clone();
  target.pathname = "/dev-access";
  target.searchParams.set("next", effectivePath);
  if (reason) target.searchParams.set("reason", reason);
  return NextResponse.redirect(target);
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
  const devAccess = evaluateDevAccess();
  const storedDevView = request.cookies.get(DEV_ACCESS_COOKIE)?.value;
  const devView = isDevAccessView(storedDevView) ? storedDevView : null;

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
  const claims = claimsResult.data?.claims as { sub?: string; email?: string; aal?: string } | undefined;

  if (apiRoute) return response;

  if (claimsResult.error && requiresAuth) {
    if (devAccess.enabled) return accessRedirect(request, effectivePath, "session-verification-failed");
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", effectivePath);
    login.searchParams.set("reason", "session-verification-failed");
    return NextResponse.redirect(login);
  }

  if (requiresAuth && !claims?.sub) {
    if (devAccess.enabled) return accessRedirect(request, effectivePath);
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.searchParams.set("next", effectivePath);
    return NextResponse.redirect(login);
  }
  if (!claims?.sub) return response;

  const supportResult = await supabase.rpc("get_my_support_session");
  if (supportResult.error) return serviceUnavailable();
  const supportSession = (supportResult.data as SupportSession[] | null)?.[0] ?? null;

  if (devAccess.enabled && devView && !matchesDevIdentity(devView, claims.email)) {
    return accessRedirect(request, effectivePath, "development-identity-mismatch");
  }

  const isDevAdmin = devAccess.enabled && devView === "admin" && matchesDevIdentity("admin", claims.email);
  const isDevWorkspace = devAccess.enabled && devView === "workspace" && matchesDevIdentity("workspace", claims.email);

  if (effectivePath.startsWith("/admin") && isDevWorkspace) {
    return accessRedirect(request, effectivePath, "choose-admin-view");
  }
  if (!effectivePath.startsWith("/admin") && featureRoutes[effectivePath] && isDevAdmin && !supportSession) {
    return accessRedirect(request, effectivePath, "choose-workspace-view");
  }
  if (effectivePath.startsWith("/admin") && isDevAdmin) return response;

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
  let workspaceAccess: WorkspaceAccess | undefined;

  if (supportSession) {
    const workspaceResult = await supabase
      .from("workspaces")
      .select("id,plan_id,status")
      .eq("id", supportSession.workspace_id)
      .maybeSingle();
    if (workspaceResult.error) return serviceUnavailable();
    if (!workspaceResult.data) return NextResponse.redirect(new URL("/admin", request.url));
    workspaceAccess = {
      workspace_id: workspaceResult.data.id,
      role: "support",
      access_profile: "platform-support",
      workspaces: {
        plan_id: workspaceResult.data.plan_id,
        status: workspaceResult.data.status,
      },
    };
  } else {
    let membershipQuery = supabase
      .from("workspace_memberships")
      .select("workspace_id,role,access_profile,workspaces!inner(plan_id,status)")
      .eq("user_id", claims.sub)
      .eq("status", "active");
    if (preferredWorkspace) membershipQuery = membershipQuery.eq("workspace_id", preferredWorkspace);
    const membershipResult = await membershipQuery.limit(1);
    if (membershipResult.error) return serviceUnavailable();
    workspaceAccess = membershipResult.data?.[0] as unknown as WorkspaceAccess | undefined;
  }

  if (!workspaceAccess) return NextResponse.redirect(new URL("/no-workspace", request.url));
  if (["suspended", "cancelled"].includes(workspaceAccess.workspaces.status)) {
    return NextResponse.redirect(new URL("/workspace-suspended", request.url));
  }

  const now = new Date().toISOString();
  const [planFeatureResult, overrideResult] = await Promise.all([
    workspaceAccess.workspaces.plan_id
      ? supabase.from("plan_features").select("enabled").eq("plan_id", workspaceAccess.workspaces.plan_id).eq("feature_key", requestedFeature).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("workspace_feature_overrides")
      .select("enabled")
      .eq("workspace_id", workspaceAccess.workspace_id)
      .eq("feature_key", requestedFeature)
      .lte("starts_at", now)
      .or(`ends_at.is.null,ends_at.gt.${now}`)
      .maybeSingle(),
  ]);
  if (planFeatureResult.error || overrideResult.error) return serviceUnavailable();

  const ownerTeamAccess = requestedFeature === "team_members" && workspaceAccess.access_profile === "owner";
  if (!ownerTeamAccess && !(overrideResult.data?.enabled ?? planFeatureResult.data?.enabled ?? false)) {
    const unavailable = new URL("/feature-unavailable", request.url);
    unavailable.searchParams.set("feature", requestedFeature);
    return NextResponse.redirect(unavailable);
  }

  if (!preferredWorkspace || supportSession) {
    response.cookies.set("bdb-workspace", workspaceAccess.workspace_id, {
      httpOnly: true,
      sameSite: "lax",
      secure: request.nextUrl.protocol === "https:",
      path: "/",
      maxAge: supportSession ? Math.max(0, Math.floor((new Date(supportSession.expires_at).getTime() - Date.now()) / 1000)) : undefined,
    });
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
