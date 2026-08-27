# Supabase backup and recovery

## Current boundary

The BDB OS Production project is on Supabase Free. Supabase does not provide
managed daily backups on this plan; its guidance is to run regular logical
exports and retain them off site. The repository therefore includes a daily
GitHub Actions workflow and a manual script. Both create a custom-format
`pg_dump`, validate its restore list, and encrypt it before publication.

The scheduled workflow runs at 03:30 UTC and keeps each encrypted GitHub
Actions artifact for seven days. Configure this repository secret before the
first real client record is stored:

- `SUPABASE_DB_URL`: the Production session-pooler or direct PostgreSQL URL,
  with a database password and SSL required.

The workflow uses PostgreSQL 17 client tools and the public certificate at
`ops/backup/bdb-os-backup-public-certificate.crt`. The matching recovery key is
`BDB-OS-Backup-Recovery-Key-2026-08-27.pem`; it is retained separately from the
repository and GitHub. Losing that key makes every backup unrecoverable. The
certificate expires on 24 August 2036 and must be rotated before then.

The dump is encrypted as CMS AuthEnvelopedData using AES-256-GCM and the
certificate's RSA-4096 public key. GitHub never receives the recovery key or a
decryption passphrase. Plaintext dumps exist only in a private temporary
directory and are removed after encryption. Record the artifact name, manifest
SHA-256 and workflow run in the release record. A workflow definition is not a
backup: the release gate stays open until one run and restore-list verification
have succeeded.

For a manual run, export `SUPABASE_DB_URL`, then run
`bash scripts/backup-supabase.sh <private-output-directory>`.

## Restore

1. Download the encrypted artifact and compare its SHA-256 with the manifest.
2. Work in a private temporary directory on a trusted host with PostgreSQL 17
   client tools.
3. Place the separately retained recovery key in the private directory, then
   decrypt the authenticated CMS envelope:

   ```bash
   openssl cms -decrypt -binary -inform DER \
     -in bdb-os-YYYYMMDDTHHMMSSZ.dump.cms \
     -recip ops/backup/bdb-os-backup-public-certificate.crt \
     -inkey BDB-OS-Backup-Recovery-Key-2026-08-27.pem \
     -out bdb-os.restore.dump
   pg_restore --list bdb-os.restore.dump
   ```

4. Prefer a fresh, isolated Supabase project for a restore drill. Restore with:

   ```bash
   export RESTORE_DB_URL='postgresql://...'
   export PGSSLMODE=require
   pg_restore --dbname="$RESTORE_DB_URL" --clean --if-exists \
     --no-owner --no-privileges --exit-on-error bdb-os.restore.dump
   ```

5. Apply any later canonical migrations, run pgTAP and the two-workspace
   isolation suite, then verify critical row counts.
6. Securely delete the decrypted dump.

Perform a restore drill before relying on the process, and quarterly thereafter.

## Storage objects

Database dumps preserve Storage metadata but not the underlying files in
`workspace-assets` or `workspace-documents`. Until S3-compatible export
credentials and an encrypted object backup are configured, uploaded files must
be treated as a separate recovery limitation. Do not claim full document
recovery from the database artifact alone.

## Release rollback points

- Database: every release migration is additive or explicitly reversible and
  is applied only after a successful encrypted backup. Record the migration
  versions in the release report.
- GitHub: record the accepted merge SHA. Revert through a new reviewed PR; do
  not rewrite `main`.
- Vercel: record the Production deployment ID. Use Vercel's prior READY
  deployment promotion/rollback control if a runtime regression appears.
