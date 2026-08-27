import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { parseDiscoveryEnquiry } from "@/lib/discovery";
import { createAdminClient } from "@/lib/supabase/admin";

const MAX_BODY_BYTES = 20_000;

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Enquiry is too large." }, { status: 413 });
  }

  const rawBody = await request.text().catch(() => "");
  if (new TextEncoder().encode(rawBody).byteLength > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Enquiry is too large." }, { status: 413 });
  }
  const body = (() => {
    try {
      return JSON.parse(rawBody) as unknown;
    } catch {
      return null;
    }
  })();
  const parsed = parseDiscoveryEnquiry(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  // Honeypot submissions receive a neutral response without entering the pipeline.
  if (parsed.value.website) return NextResponse.json({ ok: true }, { status: 201 });

  const admin = createAdminClient();
  const hashSalt = process.env.DISCOVERY_IP_HASH_SALT ?? process.env.SUPABASE_SECRET_KEY;
  if (!admin || !hashSalt) {
    return NextResponse.json({ error: "Enquiries are temporarily unavailable." }, { status: 503 });
  }

  const forwardedFor = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const clientAddress = forwardedFor || request.headers.get("x-real-ip") || "unavailable";
  const ipHash = createHash("sha256").update(`${hashSalt}:${clientAddress}`).digest("hex");
  const userAgent = request.headers.get("user-agent")?.slice(0, 300) ?? "";

  const { error } = await admin.rpc("submit_sales_enquiry", {
    p_name: parsed.value.name,
    p_business_name: parsed.value.businessName,
    p_email: parsed.value.email,
    p_starting_plan: parsed.value.startingPlan,
    p_sector: parsed.value.sector,
    p_challenge: parsed.value.challenge,
    p_team_size: parsed.value.teamSize,
    p_preferred_term: parsed.value.preferredTerm,
    p_source: "service-led-marketing-site",
    p_source_path: "/discovery",
    p_ip_hash: ipHash,
    p_user_agent: userAgent,
  });

  if (error?.message.includes("RATE_LIMITED")) {
    return NextResponse.json({ error: "Too many enquiries. Please try again later." }, { status: 429 });
  }
  if (error) return NextResponse.json({ error: "We could not save your enquiry." }, { status: 500 });

  return NextResponse.json({ ok: true }, { status: 201 });
}
