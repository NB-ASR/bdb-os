import { NextResponse, type NextRequest } from "next/server";
import { hasSupabaseConfig } from "@/lib/config";
import { updateSession } from "@/lib/supabase/proxy";

const PUBLIC_ROUTES = new Set(["/", "/login", "/pricing", "/offline", "/auth/callback"]);

function isPublicPath(pathname: string) {
  return PUBLIC_ROUTES.has(pathname)
    || pathname.startsWith("/api/stripe/webhook")
    || pathname.startsWith("/icons/");
}

export async function proxy(request: NextRequest) {
  if (!hasSupabaseConfig()) return NextResponse.next();

  const { response, claims } = await updateSession(request);
  const pathname = request.nextUrl.pathname;

  if (!claims && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  if (claims && pathname === "/login") {
    return NextResponse.redirect(new URL("/workspace", request.url));
  }

  return response;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)",
  ],
};
