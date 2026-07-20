import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { seedState } from "./seed";
import type { BdbState, WorkspaceTheme } from "./types";

type Row = Record<string, unknown>;
type QueryResult<T = unknown> = { data: T | null; error: { message: string } | null };

function requireConfigured() {
  if (!isSupabaseConfigured()) {
    throw new Error("Cloud workspace is not configured.");
  }
}

function requireResult<T>(result: QueryResult<T>, context: string): T | null {
  if (result.error) throw new Error(`${context}: ${result.error.message}`);
  return result.data;
}

export async function loadCloudWorkspace(): Promise<{ state: BdbState; workspaceId: string; role: string } | null> {
  if (!isSupabaseConfigured()) return null;
  const supabase = createClient();
  const claimsResult = await supabase.auth.getClaims();
  if (claimsResult.error) throw new Error(`Authentication could not be verified: ${claimsResult.error.message}`);
  const userId = String(claimsResult.data?.claims?.sub ?? "");
  if (!userId) return null;

  const profileResult = await supabase
    .from("profiles")
    .select("active_workspace_id")
    .eq("id", userId)
    .maybeSingle();
  const profile = requireResult(profileResult, "Profile could not be loaded");

  let membershipQuery = supabase
    .from("workspace_memberships")
    .select("workspace_id,role,access_profile,status,workspaces!inner(name,status)")
    .eq("user_id", userId)
    .eq("status", "active");
  if (profile?.active_workspace_id) membershipQuery = membershipQuery.eq("workspace_id", profile.active_workspace_id);
  const membershipResult = await membershipQuery.limit(1);
  const memberships = requireResult(membershipResult, "Workspace membership could not be loaded");
  const membership = memberships?.[0] as {
    workspace_id: string;
    role: string;
    access_profile: string;
    workspaces: { name: string; status: string };
  } | undefined;
  if (!membership) return null;
  if (["suspended", "cancelled"].includes(membership.workspaces.status)) {
    throw new Error("This workspace is not currently available.");
  }

  const workspaceId = membership.workspace_id;
  if (!profile?.active_workspace_id) {
    const profileUpdate = await supabase.from("profiles").update({ active_workspace_id: workspaceId }).eq("id", userId);
    requireResult(profileUpdate, "Active workspace could not be selected");
  }

  const [customers, invoices, bookings, messages, documents, transactions, automations, activity, settings, themes] = await Promise.all([
    supabase.from("customers").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
    supabase.from("invoices").select("*").eq("workspace_id", workspaceId).order("issued_at", { ascending: false }),
    supabase.from("bookings").select("*").eq("workspace_id", workspaceId).order("booking_date"),
    supabase.from("messages").select("*").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }),
    supabase.from("documents").select("*").eq("workspace_id", workspaceId).order("uploaded_at", { ascending: false }),
    supabase.from("bank_transactions").select("*").eq("workspace_id", workspaceId).order("transaction_date", { ascending: false }),
    supabase.from("automations").select("*").eq("workspace_id", workspaceId).order("created_at"),
    supabase.from("activity_items").select("*").eq("workspace_id", workspaceId).order("occurred_at", { ascending: false }).limit(100),
    supabase.from("workspace_settings").select("*").eq("workspace_id", workspaceId).maybeSingle(),
    supabase.from("workspace_themes").select("*").eq("workspace_id", workspaceId).maybeSingle(),
  ]);

  const customerRows = requireResult(customers, "Customers could not be loaded") ?? [];
  const invoiceRows = requireResult(invoices, "Invoices could not be loaded") ?? [];
  const bookingRows = requireResult(bookings, "Bookings could not be loaded") ?? [];
  const messageRows = requireResult(messages, "Messages could not be loaded") ?? [];
  const documentRows = requireResult(documents, "Documents could not be loaded") ?? [];
  const transactionRows = requireResult(transactions, "Transactions could not be loaded") ?? [];
  const automationRows = requireResult(automations, "Automations could not be loaded") ?? [];
  const activityRows = requireResult(activity, "Activity could not be loaded") ?? [];
  const settingsData = requireResult(settings, "Workspace settings could not be loaded");
  const themeData = requireResult(themes, "Workspace appearance could not be loaded");

  const row = (value: unknown) => value as Row;
  const settingsRow = row(settingsData ?? {});
  const themeRow = row(themeData ?? {});
  let clientLogoUrl: string | undefined;
  if (themeRow.client_logo_path) {
    const signed = await supabase.storage.from("workspace-assets").createSignedUrl(String(themeRow.client_logo_path), 3600);
    if (signed.error) throw new Error(`Workspace logo could not be loaded: ${signed.error.message}`);
    clientLogoUrl = signed.data?.signedUrl;
  }

  const theme: WorkspaceTheme = {
    preset: (themeRow.preset as WorkspaceTheme["preset"]) ?? "obsidian-gold",
    mode: (themeRow.mode as WorkspaceTheme["mode"]) ?? "dark",
    accentColor: String(themeRow.accent_color ?? "#d3a84b"),
    fontFamily: (themeRow.font_family as WorkspaceTheme["fontFamily"]) ?? "manrope",
    textScale: Number(themeRow.text_scale ?? 1),
    density: (themeRow.density as WorkspaceTheme["density"]) ?? "comfortable",
    highContrast: Boolean(themeRow.high_contrast),
    reducedMotion: Boolean(themeRow.reduced_motion),
    clientLogoPath: themeRow.client_logo_path ? String(themeRow.client_logo_path) : undefined,
    clientLogoUrl,
  };

  const state: BdbState = {
    settings: {
      businessName: membership.workspaces.name,
      ownerName: String(settingsRow.owner_name ?? "Owner"),
      email: String(settingsRow.email ?? ""),
      phone: String(settingsRow.phone ?? ""),
      currency: (settingsRow.currency as "GBP" | "EUR" | "USD") ?? "GBP",
      invoicePrefix: String(settingsRow.invoice_prefix ?? "INV"),
      vatRate: Number(settingsRow.vat_rate ?? 20),
    },
    theme,
    customers: customerRows.map((item) => { const r = row(item); return { id: String(r.id), code: String(r.code), name: String(r.name), company: String(r.company ?? ""), email: String(r.email ?? ""), phone: String(r.phone ?? ""), address: String(r.address ?? ""), notes: String(r.notes ?? ""), createdAt: String(r.created_at) }; }),
    invoices: invoiceRows.map((item) => { const r = row(item); return { id: String(r.id), number: String(r.number), customerId: String(r.customer_id), issuedAt: String(r.issued_at), dueAt: String(r.due_at), description: String(r.description), amount: Number(r.amount), status: r.status as BdbState["invoices"][number]["status"] }; }),
    bookings: bookingRows.map((item) => { const r = row(item); return { id: String(r.id), customerId: String(r.customer_id), title: String(r.title), date: String(r.booking_date), time: String(r.booking_time).slice(0, 5), duration: Number(r.duration_minutes), staff: String(r.staff_name), status: r.status as BdbState["bookings"][number]["status"] }; }),
    messages: messageRows.map((item) => { const r = row(item); return { id: String(r.id), customerId: String(r.customer_id), channel: r.channel as BdbState["messages"][number]["channel"], subject: String(r.subject), preview: String(r.preview), timestamp: String(r.occurred_at), unread: Boolean(r.unread), status: r.status as BdbState["messages"][number]["status"] }; }),
    documents: documentRows.map((item) => { const r = row(item); return { id: String(r.id), name: String(r.name), type: String(r.document_type), size: String(r.size_label), customerId: r.customer_id ? String(r.customer_id) : undefined, linkedTo: String(r.linked_to), uploadedAt: String(r.uploaded_at) }; }),
    transactions: transactionRows.map((item) => { const r = row(item); return { id: String(r.id), date: String(r.transaction_date), description: String(r.description), amount: Number(r.amount), type: r.transaction_type as "credit" | "debit", status: r.status as BdbState["transactions"][number]["status"], matchedInvoiceId: r.matched_invoice_id ? String(r.matched_invoice_id) : undefined }; }),
    automations: automationRows.map((item) => { const r = row(item); return { id: String(r.id), name: String(r.name), description: String(r.description), trigger: String(r.trigger_description), enabled: Boolean(r.enabled), lastRun: r.last_run_at ? new Date(String(r.last_run_at)).toLocaleString() : "Not run yet" }; }),
    activity: activityRows.map((item) => { const r = row(item); return { id: String(r.id), action: String(r.action), detail: String(r.detail), timestamp: String(r.occurred_at), tone: r.tone as BdbState["activity"][number]["tone"] }; }),
  };

  return { state: { ...seedState, ...state }, workspaceId, role: membership.access_profile || membership.role };
}

export async function cloudInsert(table: string, values: Row | Row[]) {
  requireConfigured();
  const { error } = await createClient().from(table).insert(values);
  if (error) throw new Error(`${table} could not be created: ${error.message}`);
}

export async function cloudUpdate(table: string, values: Row, id: string) {
  requireConfigured();
  const { data, error } = await createClient().from(table).update(values).eq("id", id).select("id");
  if (error) throw new Error(`${table} could not be updated: ${error.message}`);
  if (!data?.length) throw new Error(`${table} was not updated. Your access may have changed.`);
}

export async function cloudUpsert(table: string, values: Row, onConflict: string) {
  requireConfigured();
  const { error } = await createClient().from(table).upsert(values, { onConflict });
  if (error) throw new Error(`${table} could not be saved: ${error.message}`);
}

export async function uploadWorkspaceLogo(workspaceId: string, file: File) {
  requireConfigured();
  if (file.size > 5_000_000) throw new Error("Logo files must be 5 MB or smaller.");
  const supabase = createClient();
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  const path = `${workspaceId}/branding/${crypto.randomUUID()}-${safeName}`;
  const upload = await supabase.storage.from("workspace-assets").upload(path, file, { cacheControl: "3600", upsert: false });
  if (upload.error) throw upload.error;
  const signed = await supabase.storage.from("workspace-assets").createSignedUrl(path, 3600);
  if (signed.error) {
    await supabase.storage.from("workspace-assets").remove([path]);
    throw signed.error;
  }
  return { path, url: signed.data?.signedUrl };
}

export async function uploadWorkspaceDocument(workspaceId: string, file: File) {
  requireConfigured();
  const supabase = createClient();
  const safeName = file.name.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  const path = `${workspaceId}/documents/${new Date().getFullYear()}/${crypto.randomUUID()}-${safeName}`;
  const upload = await supabase.storage.from("workspace-documents").upload(path, file, { cacheControl: "3600", upsert: false });
  if (upload.error) throw upload.error;
  return path;
}

export async function removeWorkspaceDocument(path: string) {
  requireConfigured();
  const { error } = await createClient().storage.from("workspace-documents").remove([path]);
  if (error) throw error;
}
