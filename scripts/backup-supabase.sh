#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${SUPABASE_DB_URL:-}" ]]; then
  echo "SUPABASE_DB_URL is required." >&2
  exit 2
fi
export PGSSLMODE="${PGSSLMODE:-require}"

backup_output_dir="${1:-backup-output}"
public_certificate="${BACKUP_PUBLIC_CERTIFICATE_FILE:-ops/backup/bdb-os-backup-public-certificate.crt}"
backup_timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
encrypted_dump="${backup_output_dir}/bdb-os-${backup_timestamp}.dump.cms"
manifest="${backup_output_dir}/bdb-os-${backup_timestamp}.manifest.txt"

if [[ ! -f "${public_certificate}" ]]; then
  echo "Backup public certificate not found: ${public_certificate}" >&2
  exit 2
fi
openssl x509 -in "${public_certificate}" -noout -checkend 0 >/dev/null
recipient_fingerprint="$(
  openssl x509 -in "${public_certificate}" -noout -fingerprint -sha256 \
    | cut -d= -f2 \
    | tr -d ':'
)"
backup_tmp_dir="$(mktemp -d)"
plain_dump="${backup_tmp_dir}/bdb-os-${backup_timestamp}.dump"

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

umask 077
mkdir -p "${backup_output_dir}"

pg_dump \
  --dbname="${SUPABASE_DB_URL}" \
  --format=custom \
  --compress=9 \
  --no-owner \
  --no-privileges \
  --no-subscriptions \
  --file="${plain_dump}"

# A readable archive table-of-contents proves the dump is structurally valid
# before encryption and upload.
pg_restore --list "${plain_dump}" >/dev/null

openssl cms -encrypt -binary -aes-256-gcm \
  -in "${plain_dump}" \
  -outform DER \
  -out "${encrypted_dump}" \
  "${public_certificate}"

# Parse the encrypted envelope before publishing it. AES-256-GCM uses CMS
# AuthEnvelopedData, which provides confidentiality and tamper detection.
openssl cms -cmsout -inform DER -in "${encrypted_dump}" -noout

{
  echo "created_at_utc=${backup_timestamp}"
  echo "project_ref=${SUPABASE_PROJECT_REF:-unknown}"
  echo "format=pg_dump_custom_cms_auth_enveloped_aes_256_gcm"
  echo "recipient_certificate_sha256=${recipient_fingerprint}"
  echo "encrypted_sha256=$(sha256sum "${encrypted_dump}" | awk '{print $1}')"
} >"${manifest}"

echo "Encrypted backup created: ${encrypted_dump}"
