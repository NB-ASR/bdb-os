#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is required." >&2
  exit 2
fi
if [[ -z "${BACKUP_ENCRYPTION_PASSPHRASE:-}" ]]; then
  echo "BACKUP_ENCRYPTION_PASSPHRASE is required." >&2
  exit 2
fi
export PGSSLMODE="${PGSSLMODE:-require}"

backup_output_dir="${1:-backup-output}"
backup_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_tmp_dir="$(mktemp -d)"
plain_dump="${backup_tmp_dir}/bdb-os-${backup_timestamp}.dump"
encrypted_dump="${backup_output_dir}/bdb-os-${backup_timestamp}.dump.enc"
manifest="${backup_output_dir}/bdb-os-${backup_timestamp}.manifest.txt"

cleanup() {
  if [[ -f "${plain_dump}" ]]; then
    if command -v shred >/dev/null 2>&1; then
      shred -u "${plain_dump}"
    else
      rm -f "${plain_dump}"
    fi
  fi
  rmdir "${backup_tmp_dir}" 2>/dev/null || true
}
trap cleanup EXIT

mkdir -p "${backup_output_dir}"
umask 077

pg_dump \
  --dbname="${SUPABASE_DB_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --file="${plain_dump}"

# A readable archive table-of-contents proves the dump is structurally valid
# before encryption and upload.
pg_restore --list "${plain_dump}" >/dev/null

openssl enc -aes-256-cbc -salt -pbkdf2 -iter 250000 \
  -in "${plain_dump}" \
  -out "${encrypted_dump}" \
  -pass env:BACKUP_ENCRYPTION_PASSPHRASE

{
  echo "created_at_utc=${backup_timestamp}"
  echo "project_ref=${SUPABASE_PROJECT_REF:-unknown}"
  echo "format=pg_dump_custom_aes_256_cbc_pbkdf2"
  echo "encrypted_sha256=$(sha256sum "${encrypted_dump}" | awk '{print $1}')"
} >"${manifest}"

echo "Encrypted backup created: ${encrypted_dump}"
