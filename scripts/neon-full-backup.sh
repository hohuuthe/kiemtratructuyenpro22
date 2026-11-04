#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DATABASE_URL="${SOURCE_DATABASE_URL:-${NEON_DATABASE_URL:-}}"
POSTGRES_IMAGE="${POSTGRES_IMAGE:-postgres:18}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_FILE="${1:-backups/neon-full-backup-${STAMP}.tar.gz}"

if [[ -z "${SOURCE_DATABASE_URL}" ]]; then
  echo "ERROR: SOURCE_DATABASE_URL or NEON_DATABASE_URL is required." >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required to run the pinned PostgreSQL client image." >&2
  exit 3
fi

mkdir -p "$(dirname "${BACKUP_FILE}")"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "${WORK_DIR}"' EXIT
chmod 700 "${WORK_DIR}"

echo "Creating complete PostgreSQL database archive with ${POSTGRES_IMAGE} ..."

docker run --rm \
  -e DATABASE_URL="${SOURCE_DATABASE_URL}" \
  -v "${WORK_DIR}:/backup" \
  "${POSTGRES_IMAGE}" \
  sh -ceu '
    umask 077

    pg_dump "$DATABASE_URL" \
      --format=custom \
      --compress=9 \
      --file=/backup/database.dump

    pg_restore --list /backup/database.dump > /backup/database.list

    {
      echo "backup_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
      echo "database=$(psql "$DATABASE_URL" -X -A -t -c "select current_database()")"
      echo "server_version=$(psql "$DATABASE_URL" -X -A -t -c "show server_version")"
      echo "server_version_num=$(psql "$DATABASE_URL" -X -A -t -c "show server_version_num")"
      echo "schemas=$(psql "$DATABASE_URL" -X -A -t -c "select count(*) from pg_namespace where nspname !~ '"'"'^pg_'"'"' and nspname <> '"'"'information_schema'"'"'")"
      echo "tables=$(psql "$DATABASE_URL" -X -A -t -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('"'"'r'"'"','"'"'p'"'"') and n.nspname !~ '"'"'^pg_'"'"' and n.nspname <> '"'"'information_schema'"'"'")"
      echo "views=$(psql "$DATABASE_URL" -X -A -t -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('"'"'v'"'"','"'"'m'"'"') and n.nspname !~ '"'"'^pg_'"'"' and n.nspname <> '"'"'information_schema'"'"'")"
      echo "sequences=$(psql "$DATABASE_URL" -X -A -t -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='"'"'S'"'"' and n.nspname !~ '"'"'^pg_'"'"' and n.nspname <> '"'"'information_schema'"'"'")"
      echo "functions=$(psql "$DATABASE_URL" -X -A -t -c "select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname !~ '"'"'^pg_'"'"' and n.nspname <> '"'"'information_schema'"'"'")"
      echo "extensions=$(psql "$DATABASE_URL" -X -A -t -c "select count(*) from pg_extension")"
    } > /backup/source_metadata.txt

    if pg_dumpall --dbname="$DATABASE_URL" --globals-only --no-role-passwords > /backup/globals.sql 2>/backup/globals.stderr; then
      echo "globals_status=ok" >> /backup/source_metadata.txt
    else
      : > /backup/globals.sql
      echo "globals_status=not_available_on_source_role" >> /backup/source_metadata.txt
    fi

    cd /backup
    sha256sum database.dump database.list globals.sql source_metadata.txt > SHA256SUMS
  '

tar -C "${WORK_DIR}" -czf "${BACKUP_FILE}" \
  database.dump \
  database.list \
  globals.sql \
  globals.stderr \
  source_metadata.txt \
  SHA256SUMS

if [[ ! -s "${BACKUP_FILE}" ]]; then
  echo "ERROR: Backup file was not created." >&2
  exit 4
fi

echo "Backup created: ${BACKUP_FILE}"
echo "Size: $(du -h "${BACKUP_FILE}" | awk '{print $1}')"
