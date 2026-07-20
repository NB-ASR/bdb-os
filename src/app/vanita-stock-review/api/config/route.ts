export const dynamic = "force-dynamic";

export async function GET() {
  const supabaseUrl = process.env.VANITA_SUPABASE_URL || "";
  const supabaseAnonKey = process.env.VANITA_SUPABASE_ANON_KEY || "";

  return Response.json(
    {
      configured: Boolean(supabaseUrl && supabaseAnonKey),
      supabaseUrl,
      supabaseAnonKey,
    },
    {
      headers: {
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
      },
    },
  );
}
