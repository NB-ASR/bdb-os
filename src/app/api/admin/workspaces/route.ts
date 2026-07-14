import { NextResponse, type NextRequest } from "next/server";
import { getAdminClient } from "@/lib/supabase/admin";
import { requirePlatformAdmin } from "@/lib/supabase/platform-admin";
import { allEntitlements, planCatalog } from "@/lib/saas/catalog";
import type { FeatureKey, PlanCode } from "@/lib/saas/types";

const demoClients = [
  {
    id: "demo-northstar",
    name: "Northstar Studio",
    slug: "northstar-studio",
    status: "active",
    planCode: "pro",
    planName: "Pro",
    memberCount: 4,
    contract: { id: "contract-1", status: "active", minimumTermMonths: 6, monthlyAmount: 349, currency: "GBP", startsOn: "2026-07-01", minimumEndsOn: "2027-01-01" },
    features: allEntitlements,
  },
  {
    id: "demo-harbour",
    name: "Harbour Electrical",
    slug: "harbour-electrical",
    status: "trial",
    planCode: "growth",
    planName: "Growth",
    memberCount: 2,
    contract: { id: "contract-2", status: "sent", minimumTermMonths: 3, monthlyAmount: 229, currency: "GBP", startsOn: null, minimumEndsOn: null },
    features: Object.fromEntries(Object.keys(allEntitlements).map((key) => [key, planCatalog[1].features.includes(key as FeatureKey)])),
  },
];

function failure(error: "unauthenticated" | "forbidden" | "not_configured") {
  return NextResponse.json({ error }, { status: error === "unauthenticated" ? 401 : error === "forbidden" ? 403 : 503 });
}

export async function GET() {
  const auth = await requirePlatformAdmin();
  if (auth.error === "not_configured") return NextResponse.json({ clients: demoClients, demo: true });
  if (auth.error) return failure(auth.error);
  const admin = getAdminClient();
  if (!admin) return failure("not_configured");

  const [workspaceResult, planResult, featureResult, planFeatureResult, contractResult, overrideResult, membershipResult] = await Promise.all([
    admin.from("workspaces").select("id, name, slug, status, plan_id, created_at").order("created_at", { ascending: false }),
    admin.from("plans").select("id, code, name").eq("is_active", true),
    admin.from("features").select("key").eq("is_active", true),
    admin.from("plan_features").select("plan_id, feature_key, enabled"),
    admin.from("contracts").select("id, workspace_id, status, minimum_term_months, monthly_amount, currency, starts_on, minimum_ends_on").order("created_at", { ascending: false }),
    admin.from("workspace_feature_overrides").select("workspace_id, feature_key, enabled, starts_at, ends_at"),
    admin.from("workspace_memberships").select("workspace_id, user_id").eq("status", "active"),
  ]);

  const firstError = [workspaceResult, planResult, featureResult, planFeatureResult, contractResult, overrideResult, membershipResult].find((result) => result.error)?.error;
  if (firstError) return NextResponse.json({ error: firstError.message }, { status: 500 });

  const plans = planResult.data ?? [];
  const features = (featureResult.data ?? []).map((feature) => feature.key as FeatureKey);
  const now = Date.now();
  const clients = (workspaceResult.data ?? []).map((workspace) => {
    const plan = plans.find((item) => item.id === workspace.plan_id);
    const base = Object.fromEntries(features.map((key) => [key, Boolean((planFeatureResult.data ?? []).find((item) => item.plan_id === workspace.plan_id && item.feature_key === key)?.enabled)])) as Record<FeatureKey, boolean>;
    (overrideResult.data ?? []).filter((item) => item.workspace_id === workspace.id && (!item.starts_at || Date.parse(item.starts_at) <= now) && (!item.ends_at || Date.parse(item.ends_at) > now)).forEach((item) => { base[item.feature_key as FeatureKey] = item.enabled; });
    const contract = (contractResult.data ?? []).find((item) => item.workspace_id === workspace.id);
    return {
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      status: workspace.status,
      planCode: (plan?.code ?? "starter") as PlanCode,
      planName: plan?.name ?? "Custom",
      memberCount: (membershipResult.data ?? []).filter((item) => item.workspace_id === workspace.id).length,
      contract: contract ? {
        id: contract.id,
        status: contract.status,
        minimumTermMonths: contract.minimum_term_months,
        monthlyAmount: contract.monthly_amount === null ? null : Number(contract.monthly_amount),
        currency: contract.currency,
        startsOn: contract.starts_on,
        minimumEndsOn: contract.minimum_ends_on,
      } : null,
      features: base,
    };
  });

  return NextResponse.json({ clients, demo: false });
}

interface WorkspaceUpdate {
  workspaceId: string;
  planCode: PlanCode;
  status: "trial" | "active" | "suspended" | "cancelled";
  minimumTermMonths: 3 | 6;
  monthlyAmount: number | null;
  currency: "GBP" | "EUR" | "USD";
  features: Partial<Record<FeatureKey, boolean>>;
}

function parseUpdate(value: unknown): WorkspaceUpdate | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  if (typeof input.workspaceId !== "string" || !["starter", "growth", "pro"].includes(String(input.planCode)) || !["trial", "active", "suspended", "cancelled"].includes(String(input.status)) || ![3, 6].includes(Number(input.minimumTermMonths)) || !["GBP", "EUR", "USD"].includes(String(input.currency)) || !input.features || typeof input.features !== "object") return null;
  const monthlyAmount = input.monthlyAmount === null || input.monthlyAmount === "" ? null : Number(input.monthlyAmount);
  if (monthlyAmount !== null && (!Number.isFinite(monthlyAmount) || monthlyAmount < 0 || monthlyAmount > 1_000_000)) return null;
  return { workspaceId: input.workspaceId, planCode: input.planCode as PlanCode, status: input.status as WorkspaceUpdate["status"], minimumTermMonths: Number(input.minimumTermMonths) as 3 | 6, monthlyAmount, currency: input.currency as WorkspaceUpdate["currency"], features: input.features as WorkspaceUpdate["features"] };
}

export async function PATCH(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await requirePlatformAdmin();
  if (auth.error === "not_configured") return NextResponse.json({ ok: true, demo: true });
  if (auth.error) return failure(auth.error);
  const body = parseUpdate(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "Invalid workspace update." }, { status: 400 });
  const admin = getAdminClient();
  if (!admin) return failure("not_configured");

  const { data: plan, error: planError } = await admin.from("plans").select("id").eq("code", body.planCode).eq("is_active", true).single();
  if (planError || !plan) return NextResponse.json({ error: "Plan not found." }, { status: 400 });

  const { error: workspaceError } = await admin.from("workspaces").update({ plan_id: plan.id, status: body.status }).eq("id", body.workspaceId);
  if (workspaceError) return NextResponse.json({ error: workspaceError.message }, { status: 500 });

  const { data: existingContract } = await admin.from("contracts").select("id, status, starts_on").eq("workspace_id", body.workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const startsOn = existingContract?.starts_on ?? (body.status === "active" ? new Date().toISOString().slice(0, 10) : null);
  const minimumEndsOn = startsOn ? addMonths(startsOn, body.minimumTermMonths) : null;
  const contractValues = { plan_id: plan.id, minimum_term_months: body.minimumTermMonths, monthly_amount: body.monthlyAmount, currency: body.currency, starts_on: startsOn, minimum_ends_on: minimumEndsOn, status: existingContract?.status ?? "sent", created_by: auth.userId };
  const contractResult = existingContract
    ? await admin.from("contracts").update(contractValues).eq("id", existingContract.id)
    : await admin.from("contracts").insert({ ...contractValues, workspace_id: body.workspaceId });
  if (contractResult.error) return NextResponse.json({ error: contractResult.error.message }, { status: 500 });

  const overrides = Object.entries(body.features).filter((entry): entry is [FeatureKey, boolean] => typeof entry[1] === "boolean").map(([feature_key, enabled]) => ({ workspace_id: body.workspaceId, feature_key, enabled, reason: "Bespoke contract configuration", created_by: auth.userId }));
  const { error: deleteError } = await admin.from("workspace_feature_overrides").delete().eq("workspace_id", body.workspaceId);
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 });
  if (overrides.length) {
    const { error: overrideError } = await admin.from("workspace_feature_overrides").insert(overrides);
    if (overrideError) return NextResponse.json({ error: overrideError.message }, { status: 500 });
  }

  await admin.from("audit_logs").insert({ workspace_id: body.workspaceId, actor_user_id: auth.userId, action: "workspace.contract_updated", entity_type: "workspace", entity_id: body.workspaceId, metadata: { planCode: body.planCode, features: body.features } });
  return NextResponse.json({ ok: true });
}

function addMonths(date: string, months: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + months);
  return value.toISOString().slice(0, 10);
}

interface NewClient {
  name: string;
  email: string;
  planCode: PlanCode;
  minimumTermMonths: 3 | 6;
  monthlyAmount: number | null;
  currency: "GBP" | "EUR" | "USD";
}

function parseNewClient(value: unknown): NewClient | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const amount = input.monthlyAmount === null || input.monthlyAmount === "" ? null : Number(input.monthlyAmount);
  if (typeof input.name !== "string" || input.name.trim().length < 2 || typeof input.email !== "string" || !/^\S+@\S+\.\S+$/.test(input.email) || !["starter", "growth", "pro"].includes(String(input.planCode)) || ![3, 6].includes(Number(input.minimumTermMonths)) || !["GBP", "EUR", "USD"].includes(String(input.currency)) || (amount !== null && (!Number.isFinite(amount) || amount < 0))) return null;
  return { name: input.name.trim(), email: input.email.toLowerCase(), planCode: input.planCode as PlanCode, minimumTermMonths: Number(input.minimumTermMonths) as 3 | 6, monthlyAmount: amount, currency: input.currency as NewClient["currency"] };
}

export async function POST(request: NextRequest) {
  if (!isSameOrigin(request)) return NextResponse.json({ error: "Invalid request origin." }, { status: 403 });
  const auth = await requirePlatformAdmin();
  if (auth.error === "not_configured") return NextResponse.json({ ok: true, id: `demo-${Date.now()}`, demo: true });
  if (auth.error) return failure(auth.error);
  const body = parseNewClient(await request.json().catch(() => null));
  if (!body) return NextResponse.json({ error: "Invalid client details." }, { status: 400 });
  const admin = getAdminClient();
  if (!admin) return failure("not_configured");

  const { data: plan } = await admin.from("plans").select("id").eq("code", body.planCode).single();
  if (!plan) return NextResponse.json({ error: "Plan not found." }, { status: 400 });
  const redirectTo = `${new URL(request.url).origin}/auth/callback?next=/workspace`;
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(body.email, { redirectTo, data: { full_name: body.name } });
  if (inviteError || !invited.user) return NextResponse.json({ error: inviteError?.message ?? "Could not invite the client." }, { status: 400 });

  const slug = `${slugify(body.name)}-${crypto.randomUUID().slice(0, 6)}`.slice(0, 63);
  const { data: workspace, error: workspaceError } = await admin.from("workspaces").insert({ name: body.name, slug, status: "trial", plan_id: plan.id }).select("id").single();
  if (workspaceError || !workspace) return NextResponse.json({ error: workspaceError?.message ?? "Could not create workspace." }, { status: 500 });
  const setupResults = await Promise.all([
    admin.from("workspace_memberships").insert({ workspace_id: workspace.id, user_id: invited.user.id, role: "owner", status: "active", invited_by: auth.userId, joined_at: new Date().toISOString() }),
    admin.from("workspace_themes").insert({ workspace_id: workspace.id, updated_by: auth.userId }),
    admin.from("workspace_settings").insert({ workspace_id: workspace.id, owner_name: body.name, email: body.email }),
    admin.from("contracts").insert({ workspace_id: workspace.id, plan_id: plan.id, status: "sent", minimum_term_months: body.minimumTermMonths, monthly_amount: body.monthlyAmount, currency: body.currency, starts_on: null, minimum_ends_on: null, created_by: auth.userId }),
    admin.from("audit_logs").insert({ workspace_id: workspace.id, actor_user_id: auth.userId, action: "workspace.provisioned", entity_type: "workspace", entity_id: workspace.id, metadata: { email: body.email, planCode: body.planCode } }),
  ]);
  const setupError = setupResults.find((result) => result.error)?.error;
  if (setupError) return NextResponse.json({ error: setupError.message }, { status: 500 });
  return NextResponse.json({ ok: true, id: workspace.id });
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 54) || "client";
}

function isSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}
