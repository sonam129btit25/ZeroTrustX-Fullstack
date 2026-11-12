#!/bin/sh
set -e
echo "Waiting for PostgreSQL..."
until pg_isready -d "$(echo "$DATABASE_URL" | sed 's/+psycopg//')" >/dev/null 2>&1; do sleep 1; done
echo "Applying migrations"
alembic upgrade head
if [ "${SEED_DEMO_DATA:-false}" = "true" ]; then
  python -m app.db.seed
else
  python -m app.db.seed --no-demo
fi
exec "$@"
