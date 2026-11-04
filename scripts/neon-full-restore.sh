#!/usr/bin/env bash
set -Eeuo pipefail

BACKUP_FILE="${1:-}"
TARGET_DATABASE_URL="${TARGET_DATABASE_URL:-${NEON_TARGET_DATABASE_URL:-}}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18}"

if [[ -z "${BACKUP_FILE}" || ! -f "${BACKUP_FILE}" ]]; then
  echo "ERROR: Usage: TARGET_DATABASE_URL=... ALLOW_DESTRUCTIVE_RESTORE=YES $0 <backup.tar.gz>" >&2
  exit 2
fi

if [[ -z "${TARGET_DATABASE_URL}" ]]; then
  echo "ERROR: TARGET_DATABASE_URL or NEON_TARGET_DATABASE_URL is required." >&2
  exit 3
fi

if [[ "${ALLOW_DESTRUCTIVE_RESTORE:-}" != "YES" ]]; then
  echo "ERROR: Restore uses --clean and can replace objects in the target database." >&2
  echo "Set ALLOW_DESTRUCTIVE_RESTORE=YES only for the intended target database." >&2
  exit 4
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required to run the pinned PostgreSQL client image." >&2
  exit 5
fi

WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT
chmod 700 "${WORK_DIR}"

tar -xzf "${BACKUP_FILE}" -C "${WORK_DIR}"

for required in database.dump database.list source_metadata.txt SHA256SUMS; do
  if [[ ! -f "${WORK_DIR}/${required}" ]]; then
    echo "ERROR: Backup package is missing ${required}." >&2
    exit 6
  fi
done

(
  cd "${WORK_DIR}"
  sha256sum -c SHA256SUMS
)

echo "Backup integrity verified. Restoring database-level objects ..."

docker run --rm \
  -e DATABASE_URL="${TARGET_DATABASE_URL}" \
  -v "${WORK_DIR}:/restore:ro" \
  "${POSTGRES_IMAGE}" \
  sh -ceu '
    pg_restore --list /restore/database.dump >/dev/null

    pg_restore \
      --dbname="$DATABASE_URL" \
      --clean \
      --if-exists \
      --no-owner \
      --no-privileges \
      --exit-on-error \
      --single-transaction \
      /restore/database.dump

    echo "target_database=$(psql "$DATABASE_URL" -X -A -t -c "select current_database()")"
    echo "target_server_version=$(psql "$DATABASE_URL" -X -A -t -c "show server_version")"
    echo "target_tables=$(psql "$DATABASE_URL" -X -A -t -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('"'"'r'"'"','"'"'p'"'"') and n.nspname !~ '"'"'^pg_'"'"' and n.nspname <> '"'"'information_schema'"'"'")"
  '

echo "Restore completed successfully from: ${BACKUP_FILE}"
