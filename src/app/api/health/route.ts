import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

async function health() {
  const startedAt = Date.now();
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY &&
    process.env.SUPABASE_SECRET_KEY,
  );

  if (!configured) {
    return Response.json(
      {
        status: "degraded",
        checks: { configuration: false, database: false },
        release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
      },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }

  const admin = createAdminClient();
  const { error } = admin
    ? await admin.from("workspaces").select("id").limit(1)
    : { error: new Error("Admin client unavailable") };
  const database = !error;

  return Response.json(
    {
      status: database ? "ok" : "degraded",
      checks: { configuration: true, database },
      release: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? "local",
      responseTimeMs: Date.now() - startedAt,
    },
    { status: database ? 200 : 503, headers: NO_STORE_HEADERS },
  );
}

export async function GET() {
  return health();
}

export async function HEAD() {
  const response = await health();
  return new Response(null, { status: response.status, headers: response.headers });
}
