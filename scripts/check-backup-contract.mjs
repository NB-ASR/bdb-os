import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [script, runbook, workflow, publicCertificate] = await Promise.all([
  readFile("scripts/backup-supabase.sh", "utf8"),
  readFile("docs/runbooks/supabase-backup-recovery.md", "utf8"),
  readFile(".github/workflows/supabase-backup.yml", "utf8"),
  readFile("ops/backup/bdb-os-backup-public-certificate.crt", "utf8"),
]);

assert.match(script, /pg_dump/);
assert.match(script, /pg_restore --list/);
assert.match(script, /openssl cms -encrypt -binary -aes-256-gcm/);
assert.match(script, /openssl cms -cmsout/);
assert.match(script, /PGSSLMODE/);
assert.doesNotMatch(script, /BACKUP_ENCRYPTION_PASSPHRASE/);
assert.doesNotMatch(script, /\+\s+--/);
assert.doesNotMatch(script, /\+\s+-(?:in|out|pass)\b/);
assert.match(workflow, /schedule:/);
assert.match(workflow, /workflow_dispatch:/);
assert.match(workflow, /secrets\.SUPABASE_DB_URL/);
assert.match(workflow, /actions\/upload-artifact@v4/);
assert.match(workflow, /retention-days:\s*7/);
assert.match(workflow, /chown -R/);
assert.match(workflow, /chmod 600/);
assert.match(publicCertificate, /-----BEGIN CERTIFICATE-----/);
assert.match(publicCertificate, /-----END CERTIFICATE-----/);
assert.doesNotMatch(publicCertificate, /PRIVATE KEY/);
assert.match(runbook, /restore drill/i);
assert.match(runbook, /Storage objects/i);
assert.match(runbook, /GitHub\s+Actions artifact/i);

console.log("Encrypted Supabase backup and recovery contracts passed.");
