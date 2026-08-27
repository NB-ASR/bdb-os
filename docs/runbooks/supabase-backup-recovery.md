# Supabase backup and recovery

## Current boundary

The BDB OS Production project is on Supabase Free. Supabase does not provide
managed daily backups on this plan; its guidance is to run regular logical
exports and retain them off site. The repository therefore includes a manual
script that creates an encrypted custom-format `pg_dump` and validates the
archive before encryption.

Before the first real client record is stored, provide these values through a
trusted secret manager on the backup runner:

- `SUPABASE_DB_URL`: the Production session-pooler or direct PostgreSQL URL,
  with a database password and SSL required.
- `BACKUP_ENCRYPTION_PASSPHRASE`: an independent high-entropy secret kept
  outside Supabase and Vercel.

Run `bash scripts/backup-supabase.sh <private-output-directory>` and retain the
artifact SHA-256 in the release record. Plaintext dumps exist only in the
temporary directory and are removed after encryption.

Do not upload Production data to GitHub Actions artifacts or another general
build system by default. Select and explicitly approve an encrypted backup
destination with access control and retention appropriate for client data,
then automate the same script against that destination. Until that destination
and the required secrets are approved, the backup release gate remains open.

## Restore

1. Download the encrypted artifact and compare its SHA-256 with the manifest.
2. Work in a private temporary directory on a trusted host with PostgreSQL 17
   client tools.
3. Decrypt without exposing the passphrase in shell history:

   ```bash
   export BACKUP_ENCRYPTION_PASSPHRASE='loaded-from-a-secret-manager'
   openssl enc -d -aes-256-cbc -pbkdf2 -iter 250000 \
     -in bdb-os-YYYYMMDDTHHMMSSZ.dump.enc \
     -out bdb-os.restore.dump \
     -pass env:BACKUP_ENCRYPTION_PASSPHRASE
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
