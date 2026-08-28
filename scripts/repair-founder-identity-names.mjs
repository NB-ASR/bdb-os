import process from "node:process";
import { createClient } from "@supabase/supabase-js";

const corrections = [
  { email: "nicholasbianchini10@gmail.com", fullName: "Nicholas Bianchini" },
  { email: "matdem553@gmail.com", fullName: "Matthew Demicoli" },
];

const apply = process.argv.includes("--apply");
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const admin = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const { data: listed, error: listError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (listError) throw listError;

for (const correction of corrections) {
  const user = listed.users.find((candidate) => candidate.email?.toLowerCase() === correction.email);
  if (!user) throw new Error(`Required founder account was not found: ${correction.email}`);
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", user.id)
    .maybeSingle();
  if (profileError) throw profileError;
  const authName = typeof user.user_metadata?.full_name === "string" ? user.user_metadata.full_name : "";
  console.log(`${correction.email}: Auth=${JSON.stringify(authName)}, Profile=${JSON.stringify(profile?.full_name ?? "")}, Expected=${JSON.stringify(correction.fullName)}`);

  if (!apply) continue;
  const authUpdate = await admin.auth.admin.updateUserById(user.id, {
    user_metadata: { ...user.user_metadata, full_name: correction.fullName },
  });
  if (authUpdate.error) throw authUpdate.error;
  const { error: updateProfileError } = await admin
    .from("profiles")
    .upsert({ id: user.id, full_name: correction.fullName }, { onConflict: "id" });
  if (updateProfileError) throw updateProfileError;
}

if (!apply) {
  console.log("Dry run only. Re-run with --apply after the exact reviewed release SHA is approved.");
  process.exit(0);
}

const { data: verifiedUsers, error: verifyUsersError } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (verifyUsersError) throw verifyUsersError;
for (const correction of corrections) {
  const user = verifiedUsers.users.find((candidate) => candidate.email?.toLowerCase() === correction.email);
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("full_name")
    .eq("id", user?.id ?? "00000000-0000-0000-0000-000000000000")
    .maybeSingle();
  if (profileError) throw profileError;
  if (user?.user_metadata?.full_name !== correction.fullName || profile?.full_name !== correction.fullName) {
    throw new Error(`Identity consistency verification failed for ${correction.email}`);
  }
  console.log(`Verified ${correction.email} -> ${correction.fullName} in Auth metadata and profile.`);
}
