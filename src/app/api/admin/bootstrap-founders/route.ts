import { createAdminClient } from "@/lib/supabase/admin";

function authorised(request: Request) {
  const expected = process.env.FOUNDER_BOOTSTRAP_SECRET;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return Boolean(expected && supplied && expected === supplied);
}

export async function POST(request: Request) {
  if (!authorised(request)) {
    return Response.json({ error: "FORBIDDEN" }, { status: 403 });
  }
  const admin = createAdminClient();
  const temporaryPassword = process.env.FOUNDER_INITIAL_PASSWORD;
  const founderEmails = (process.env.BDB_FOUNDER_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  const founderNames = (process.env.BDB_FOUNDER_NAMES ?? "")
    .split(",")
    .map((name) => name.trim());

  if (!admin || !temporaryPassword || founderEmails.length === 0) {
    return Response.json({ error: "Founder bootstrap is not configured." }, { status: 503 });
  }
  if (temporaryPassword.length < 12) {
    return Response.json({ error: "The temporary password must be at least 12 characters." }, { status: 400 });
  }

  const { data: userPage, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listError) return Response.json({ error: listError.message }, { status: 500 });
  const existingByEmail = new Map(userPage.users.map((user) => [user.email?.toLowerCase(), user]));
  const results: Array<{ email: string; status: string }> = [];

  for (const [index, email] of founderEmails.entries()) {
    const fullName = founderNames[index] || email.split("@")[0];
    let user = existingByEmail.get(email);
    if (!user) {
      const created = await admin.auth.admin.createUser({
        email,
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { founder_bootstrap: true, full_name: fullName },
      });
      if (created.error || !created.data.user) {
        results.push({ email, status: created.error?.message ?? "creation failed" });
        continue;
      }
      user = created.data.user;
    } else {
      const updated = await admin.auth.admin.updateUserById(user.id, {
        password: temporaryPassword,
        email_confirm: true,
        user_metadata: { ...user.user_metadata, founder_bootstrap: true, full_name: fullName },
      });
      if (updated.error) {
        results.push({ email, status: updated.error.message });
        continue;
      }
    }

    await admin.from("profiles").upsert({
      id: user.id,
      full_name: fullName,
      must_change_password: true,
      is_active: true,
    }, { onConflict: "id" });
    await admin.from("platform_admins").upsert({
      user_id: user.id,
      role: "founder",
      active: true,
    }, { onConflict: "user_id" });
    await admin.from("audit_logs").insert({
      actor_user_id: user.id,
      action: "platform.founder_bootstrap_prepared",
      entity_type: "platform_admin",
      entity_id: user.id,
      metadata: { email, full_name: fullName },
    });
    results.push({ email, status: "ready" });
  }

  return Response.json({ ok: results.every((result) => result.status === "ready"), results });
}
