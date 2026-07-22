import { planDueOperatorRuns, processOperatorQueue } from "@/lib/server/operator-worker";

export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  try {
    const planned = await planDueOperatorRuns(200);
    const processed = await processOperatorQueue(50);
    return Response.json({
      ok: true,
      durationMs: Date.now() - startedAt,
      planned,
      processed,
    }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    console.error("[cron/operator] failed", error);
    return Response.json({
      ok: false,
      error: "The Operator queue could not be processed.",
      durationMs: Date.now() - startedAt,
    }, { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } });
  }
}
