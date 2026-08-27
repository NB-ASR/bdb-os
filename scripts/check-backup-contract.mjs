import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [script, runbook] = await Promise.all([
  readFile("scripts/backup-supabase.sh", "utf8"),
  readFile("docs/runbooks/supabase-backup-recovery.md", "utf8"),
]);

assert.match(script, /pg_dump/);
assert.match(script, /pg_restore --list/);
assert.match(script, /openssl enc -aes-256-cbc/);
assert.match(script, /PGSSLMODE/);
assert.doesNotMatch(script, /\+\s+--/);
assert.doesNotMatch(script, /\+\s+-(?:in|out|pass)\b/);
assert.match(runbook, /restore drill/i);
assert.match(runbook, /Storage objects/i);
assert.match(runbook, /approve an encrypted backup\s+destination/i);

console.log("Encrypted Supabase backup and recovery contracts passed.");
