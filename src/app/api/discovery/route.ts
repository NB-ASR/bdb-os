import { createHmac } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PLANS = new Set(["not-sure", "starter", "growth", "solo-operator", "pro"]);
const SECTORS = new Set(["general", "healthcare", "wellness", "legal", "accounting", "other"]);
const TEAM_SIZES = new Set(["solo", "2-5", "6-15", "16-50", "50-plus"]);
const TERMS = new Set(["3-months", "6-months", "open"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Enquiry = {
  name: string;
  businessName: string;
  email: string;
  startingPlan: string;
  sector: string;
  challenge: string;
  teamSize: string;
  preferredTerm: string;
  sourcePath: string;
  website: string;
};

function text(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function parseEnquiry(value: unknown): Enquiry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const body = value as Record<string, unknown>;
  const enquiry = {
    name: text(body.name, 120),
    businessName: text(body.businessName, 160),
    email: text(body.email, 254).toLowerCase(),
    startingPlan: text(body.startingPlan, 40),
    sector: text(body.sector, 40),
    challenge: text(body.challenge, 4000),
    teamSize: text(body.teamSize, 40),
    preferredTerm: text(body.preferredTerm, 40),
    sourcePath: text(body.sourcePath, 300) || "/discovery",
    website: text(body.website, 200),
  };

  if (
    enquiry.name.length < 2 ||
    enquiry.businessName.length < 2 ||
    !EMAIL_PATTERN.test(enquiry.email) ||
    enquiry.challenge.length < 20 ||
    !PLANS.has(enquiry.startingPlan) ||
    !SECTORS.has(enquiry.sector) ||
    !TEAM_SIZES.has(enquiry.teamSize) ||
    !TERMS.has(enquiry.preferredTerm) ||
    !enquiry.sourcePath.startsWith("/")
  ) return null;

  return enquiry;
}

function requestAddress(request: Request) {
  const raw = request.headers.get("x-vercel-forwarded-for")
    ?? request.headers.get("x-forwarded-for")
    ?? request.headers.get("x-real-ip")
    ?? "local";
  return raw.split(",")[0]?.trim().toLowerCase() || "local";
}

async function notifySales(enquiryId: string, enquiry: Enquiry) {
  const endpoint = process.env.SALES_INTAKE_WEBHOOK_URL;
  const secret = process.env.SALES_INTAKE_WEBHOOK_SECRET;
  if (!endpoint || !secret) return;

  const target = new URL(endpoint);
  if (target.protocol !== "https:" && process.env.NODE_ENV === "production") {
    throw new Error("SALES_INTAKE_WEBHOOK_URL must use HTTPS in production.");
  }

  const payload = JSON.stringify({
    event: "sales.enquiry.created",
    occurredAt: new Date().toISOString(),
    enquiry: {
      id: enquiryId,
      name: enquiry.name,
      businessName: enquiry.businessName,
      email: enquiry.email,
      startingPlan: enquiry.startingPlan,
      sector: enquiry.sector,
      challenge: enquiry.challenge,
      teamSize: enquiry.teamSize,
      preferredTerm: enquiry.preferredTerm,
      sourcePath: enquiry.sourcePath,
    },
  });
  const signature = createHmac("sha256", secret).update(payload).digest("hex");
  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": enquiryId,
      "x-bdb-signature": `sha256=${signature}`,
    },
    body: payload,
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`Sales intake webhook returned ${response.status}.`);
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 20_000) {
    return Response.json({ error: "The enquiry is too large." }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return Response.json({ error: "Send a valid enquiry." }, { status: 400 });
  }
  const enquiry = parseEnquiry(raw);
  if (!enquiry) {
    return Response.json({ error: "Check the required fields and try again." }, { status: 400 });
  }

  // The hidden field lets obvious form bots receive an uninformative success
  // without writing junk into the commercial pipeline.
  if (enquiry.website) return Response.json({ ok: true }, { status: 202 });

  const admin = createAdminClient();
  const hashSecret = process.env.SALES_INTAKE_HASH_SECRET ?? process.env.SUPABASE_SECRET_KEY;
  if (!admin || !hashSecret) {
    console.error("Sales intake is not configured.");
    return Response.json({ error: "Enquiries are temporarily unavailable. Please try again shortly." }, { status: 503 });
  }

  const ipHash = createHmac("sha256", hashSecret).update(requestAddress(request)).digest("hex");
  const { data, error } = await admin.rpc("submit_sales_enquiry", {
    p_name: enquiry.name,
    p_business_name: enquiry.businessName,
    p_email: enquiry.email,
    p_starting_plan: enquiry.startingPlan,
    p_sector: enquiry.sector,
    p_challenge: enquiry.challenge,
    p_team_size: enquiry.teamSize,
    p_preferred_term: enquiry.preferredTerm,
    p_source: "marketing-site",
    p_source_path: enquiry.sourcePath,
    p_ip_hash: ipHash,
    p_user_agent: text(request.headers.get("user-agent"), 300),
  });

  if (error) {
    if (error.message.includes("RATE_LIMITED")) {
      return Response.json({ error: "Too many enquiries were sent. Please try again in an hour." }, { status: 429 });
    }
    console.error("Sales enquiry could not be recorded", { code: error.code });
    return Response.json({ error: "We could not record the enquiry. Please try again." }, { status: 500 });
  }

  const enquiryId = String(data);
  try {
    await notifySales(enquiryId, enquiry);
  } catch (notificationError) {
    // The database is the source of truth. A notification outage must never
    // make a successfully recorded lead look lost to the prospective client.
    console.error("Sales enquiry notification failed", { enquiryId, notificationError });
  }

  return Response.json({ ok: true, receipt: enquiryId }, { status: 201 });
}
