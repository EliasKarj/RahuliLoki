#!/bin/sh
# Bring the schema up to date, then hand over to the server.
#
# Migrations run on every boot rather than at build time: the database lives on a volume the
# image knows nothing about, and `migrate deploy` is a no-op when there is nothing to apply.
set -eu

DB_PATH="${DATABASE_URL#file:}"
mkdir -p "$(dirname "$DB_PATH")"

echo "valuuttaloki: applying migrations to $DB_PATH"
./node_modules/.bin/prisma migrate deploy --schema ./prisma/schema.prisma

exec "$@"
