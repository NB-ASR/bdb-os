import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { CommandError, parseCommandBody, requireWorkspaceCommand, runCommand } from "@/lib/server/command";
import { hashJson } from "@/lib/server/workspace-snapshot";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuid(value: unknown) {
  const result = String(value ?? "").trim();
  if (!UUID_PATTERN.test(result)) throw new CommandError("INVALID_DOCUMENT_IDENTITY_INPUT", "Workspace is invalid.");
  return result;
}

function text(value: unknown, maximum: number) {
  const result = String(value ?? "").trim();
  if (!result) return "";
  if (result.length > maximum) throw new CommandError("INVALID_DOCUMENT_IDENTITY_INPUT", "A document identity field is too long.");
  return result;
}

function prefix(value: unknown, fallback: string) {
  const result = String(value ?? fallback).trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,8}$/.test(result)) throw new CommandError("INVALID_DOCUMENT_IDENTITY_INPUT", "Document prefixes must use 1 to 8 letters, numbers or hyphens.");
  return result;
}

async function configuration(workspaceId: string) {
  const supabase = await createClient();
  if (!supabase) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
  const [workspaceResult, settingsResult, themeResult] = await Promise.all([
    supabase.from("workspaces").select("id,name,legal_name").eq("id", workspaceId).maybeSingle(),
    supabase.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    supabase.from("workspace_themes").select("*").eq("workspace_id", workspaceId).maybeSingle(),
  ]);
  const failed = [workspaceResult, settingsResult, themeResult].find((result) => result.error);
  if (failed?.error) throw failed.error;
  if (!workspaceResult.data) throw new CommandError("DOCUMENT_IDENTITY_NOT_FOUND", "Workspace could not be found.", 404);
  return { workspace: workspaceResult.data, settings: settingsResult.data ?? {}, theme: themeResult.data ?? {} };
}

export async function GET(request: Request) {
  return runCommand(async () => {
    const workspaceId = uuid(new URL(request.url).searchParams.get("workspaceId"));
    await requireWorkspaceCommand(request, workspaceId);
    const { workspace, settings } = await configuration(workspaceId);
    return {
      workspaceId,
      businessName: workspace.name,
      legalName: workspace.legal_name ?? "",
      businessAddress: settings.business_address ?? "",
      vatNumber: settings.vat_number ?? "",
      companyRegistrationNumber: settings.company_registration_number ?? "",
      invoicePrefix: settings.invoice_prefix ?? "INV",
      creditNotePrefix: settings.credit_note_prefix ?? "CN",
      deliveryNotePrefix: settings.delivery_note_prefix ?? "DN",
      paymentTermsDays: Number(settings.payment_terms_days ?? 14),
      documentFooter: settings.document_footer ?? "",
      legalReadiness: Boolean((workspace.legal_name || workspace.name) && settings.business_address && settings.vat_number),
    };
  });
}

export async function POST(request: Request) {
  return runCommand(async () => {
    const body = await parseCommandBody<Record<string, unknown>>(request);
    const workspaceId = uuid(body.workspaceId);
    const context = await requireWorkspaceCommand(request, workspaceId);
    if (!context.idempotencyKey) throw new CommandError("IDEMPOTENCY_REQUIRED", "An idempotency key is required.");

    const identity = {
      businessAddress: text(body.businessAddress, 1000),
      vatNumber: text(body.vatNumber, 64),
      companyRegistrationNumber: text(body.companyRegistrationNumber, 64),
      creditNotePrefix: prefix(body.creditNotePrefix, "CN"),
      deliveryNotePrefix: prefix(body.deliveryNotePrefix, "DN"),
      paymentTermsDays: Number(body.paymentTermsDays ?? 14),
      documentFooter: text(body.documentFooter, 1000),
    };
    if (!Number.isInteger(identity.paymentTermsDays) || identity.paymentTermsDays < 0 || identity.paymentTermsDays > 365) {
      throw new CommandError("INVALID_DOCUMENT_IDENTITY_INPUT", "Payment terms must be between 0 and 365 days.");
    }

    const { workspace, settings, theme } = await configuration(workspaceId);
    const admin = createAdminClient();
    if (!admin) throw new CommandError("NOT_CONFIGURED", "Cloud services are not configured.", 503);
    const themePayload = {
      preset: String(theme.preset ?? "obsidian-gold"),
      mode: String(theme.mode ?? "dark"),
      accentColor: String(theme.accent_color ?? "#d3a84b"),
      fontFamily: String(theme.font_family ?? "manrope"),
      textScale: Number(theme.text_scale ?? 1),
      density: String(theme.density ?? "comfortable"),
      highContrast: Boolean(theme.high_contrast),
      reducedMotion: Boolean(theme.reduced_motion),
    };
    const payload = {
      businessName: String(workspace.name ?? ""), legalName: String(workspace.legal_name ?? ""),
      ownerName: String(settings.owner_name ?? "Workspace Owner"), email: String(settings.email ?? ""), phone: String(settings.phone ?? ""),
      currency: String(settings.currency ?? "EUR"), invoicePrefix: String(settings.invoice_prefix ?? "INV"),
      vatRate: Number(settings.vat_rate ?? 0), timezone: String(settings.timezone ?? "Europe/Malta"), theme: themePayload, documentIdentity: identity,
    };
    const requestHash = hashJson({ action: "update_configuration", workspaceId, payload });
    const result = await admin.rpc("update_workspace_configuration", {
      target_workspace_id: workspaceId,
      target_actor_user_id: context.userId,
      target_idempotency_key: context.idempotencyKey,
      target_request_hash: requestHash,
      target_business_name: payload.businessName,
      target_legal_name: payload.legalName,
      target_owner_name: payload.ownerName,
      target_email: payload.email,
      target_phone: payload.phone,
      target_currency: payload.currency,
      target_invoice_prefix: payload.invoicePrefix,
      target_vat_rate: payload.vatRate,
      target_timezone: payload.timezone,
      target_theme: payload.theme,
      target_document_identity: payload.documentIdentity,
      target_command_id: context.commandId,
      target_occurred_at: new Date().toISOString(),
    });
    if (result.error) throw new CommandError("DOCUMENT_IDENTITY_REJECTED", result.error.message, 409);
    return result.data as Record<string, unknown>;
  });
}
