#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v npm >/dev/null 2>&1; then
  echo "npm is required" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

if [ ! -d node_modules ]; then
  if [ -f package-lock.json ]; then
    npm ci
  else
    npm install
  fi
fi

if [ ! -f .env ]; then
  cp .env.example .env
fi

echo "Waiting for Postgres and Redis..."
ready=0
for _ in $(seq 1 30); do
  if docker compose exec -T postgres pg_isready -U kyc -d kyc >/dev/null 2>&1 \
    && docker compose exec -T redis redis-cli ping >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [ "$ready" != "1" ]; then
  echo "Postgres or Redis is not ready. Start them with: docker compose up -d" >&2
  exit 1
fi

npx prisma generate
npx prisma migrate deploy
npx prisma db seed
exec npx tsx src/index.ts
