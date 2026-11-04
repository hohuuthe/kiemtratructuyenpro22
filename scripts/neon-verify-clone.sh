#!/usr/bin/env bash
set -Eeuo pipefail

SOURCE_DATABASE_URL="\${SOURCE_DATABASE_URL:-\${NEON_DATABASE_URL:-}}"
TARGET_DATABASE_URL="\${TARGET_DATABASE_URL:-\${NEON_TARGET_DATABASE_URL:-}}"
POSTGRES_IMAGE="\${POSTGRES_IMAGE:-postgres:18}"

if [[ -z "\${SOURCE_DATABASE_URL}" || -z "\${TARGET_DATABASE_URL}" ]]; then
  echo "ERROR: SOURCE_DATABASE_URL and TARGET_DATABASE_URL are required." >&2
  exit 2
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker is required." >&2
  exit 3
fi

WORK_DIR="\$(mktemp -d)"
trap 'rm -rf "\${WORK_DIR}"' EXIT
chmod 700 "\${WORK_DIR}"

docker run --rm \
  -e SOURCE_URL="\${SOURCE_DATABASE_URL}" \
  -e TARGET_URL="\${TARGET_DATABASE_URL}" \
  -v "\${WORK_DIR}:/verify" \
  "\${POSTGRES_IMAGE}" \
  sh -ceu '
    schema_dump() {
      url="$1"
      out="$2"
      pg_dump "$url" \
        --schema-only \
        --no-owner \
        --no-privileges \
        --file="$out"
      sed -i "/^--/d;/^[[:space:]]*$/d" "$out"
    }

    row_counts() {
      url="$1"
      out="$2"
      psql "$url" -X -qAt >"$out" <<'"'"'SQL'"'"'
SELECT format(
  '"'"'SELECT %L || E'"'"''"'"'\\t'"'"''"'"' || count(*) FROM %I.%I;'"'"',
  schemaname || '"'"'.'"'"' || tablename,
  schemaname,
  tablename
)
FROM pg_tables
WHERE schemaname !~ '"'"'^pg_'"'"'
  AND schemaname <> '"'"'information_schema'"'"'
ORDER BY schemaname, tablename;
\\gexec
SQL
      sort -o "$out" "$out"
    }

    object_inventory() {
      url="$1"
      out="$2"
      psql "$url" -X -qAt -F "|" -c "
        SELECT n.nspname, c.relkind, c.relname
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname !~ '"'"'^pg_'"'"'
          AND n.nspname <> '"'"'information_schema'"'"'
          AND c.relkind IN ('"'"'r'"'"','"'"'p'"'"','"'"'v'"'"','"'"'m'"'"','"'"'S'"'"','"'"'f'"'"')
        ORDER BY 1,2,3;
      " > "$out"
    }

    schema_dump "$SOURCE_URL" /verify/source-schema.sql
    schema_dump "$TARGET_URL" /verify/target-schema.sql
    object_inventory "$SOURCE_URL" /verify/source-objects.txt
    object_inventory "$TARGET_URL" /verify/target-objects.txt
    row_counts "$SOURCE_URL" /verify/source-row-counts.txt
    row_counts "$TARGET_URL" /verify/target-row-counts.txt

    diff -u /verify/source-objects.txt /verify/target-objects.txt
    diff -u /verify/source-row-counts.txt /verify/target-row-counts.txt

    if ! diff -u /verify/source-schema.sql /verify/target-schema.sql >/verify/schema.diff; then
      cat /verify/schema.diff >&2
      echo "ERROR: Source and target schema dumps differ." >&2
      exit 10
    fi

    echo "Clone verification passed: schema, object inventory and exact row counts match."
  '
