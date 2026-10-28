# Local backend foundation

Development only, not production-ready. This server exposes only health and
readiness endpoints. It has no authentication or customer/order/payment APIs.
The React frontend remains independent and does not call this server yet.

## Prerequisites and startup

Use Node.js 24 LTS, npm, Docker Engine/Desktop, and Docker Compose v2. Run all
commands below from `server/`:

Installation needs npm registry access, Docker image access, and HTTPS access to
`binaries.prisma.sh` for Prisma's checksum-verified schema engine downloads. If a
restricted development environment blocks that hostname, allow it in the
environment's network settings before generation/migrations. Do not disable
checksum or TLS verification to work around a denial.

```sh
cp .env.example .env # Only on first setup; preserve any existing local .env.
npm ci
docker compose up -d --wait
npm run generate
npm run db:deploy
npm run dev
```

In a second terminal:

```sh
curl --fail http://127.0.0.1:3001/api/health
curl --fail http://127.0.0.1:3001/api/ready
```

Health returns HTTP 200 and `{"status":"ok"}` without querying PostgreSQL.
Readiness performs a Prisma `SELECT 1`, returns HTTP 200 and
`{"status":"ready"}` when connected, or HTTP 503 and
`{"status":"not_ready"}` on connection/query failure. Failure details and
database credentials are never returned. Readiness checks connectivity, not
business-schema completeness or production readiness.

## Local networking and credentials

Compose publishes PostgreSQL **only** on `127.0.0.1:5433`, mapping to container
port 5432. Do not change this to a wildcard/public binding. The API also defaults
to `127.0.0.1:3001`. This is a host-run API, not an API container.

`.env.example` contains explicitly public, local-only sample database credentials:
user/database `restaurant_dev`, password `local-development-only`. Never reuse
them outside this development setup. Real `.env` files are ignored. Set your own
local values there; keep `DATABASE_URL` consistent with `POSTGRES_USER`,
`POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT`. URL-encode credentials in
the connection string. Never commit actual secrets or customer data.

Environment validation rejects missing/invalid PostgreSQL URLs and invalid API
ports before listening. Only field names are included in configuration errors.
Database connection/query timeouts bound normal readiness failures. Ctrl+C or
SIGTERM stops accepting requests, drains connections, and disconnects Prisma;
a 10-second shutdown deadline prevents indefinite waiting.

## Prisma and migrations

Prisma CLI, client, and PostgreSQL adapter use matching stable 7.x versions,
with the supported `prisma.config.ts` datasource configuration and `prisma-client`
generator. The generated client is ignored under `src/generated/prisma`; generation
does not need a running DB or `DATABASE_URL`. Run it after every clean install or
schema change, before typechecking/building. The PostgreSQL driver adapter reads
the validated runtime URL; no database URL is embedded in generated source.

The initial migration creates only a technical `DevelopmentProbe` table, with no
business data model or seeded rows. `npm run db:deploy` applies the checked-in
migration reproducibly and is safe to repeat on this local development database.
For a future intentional schema change, with PostgreSQL running, use
`npm run db:migrate -- --name descriptive_name`, review the generated SQL, and
regenerate the client. `migrate dev` may create a shadow database; the sample
local PostgreSQL user can do so. Do not point these commands at production.

## Checks and compiled startup

```sh
npm ci
npm run generate
npm run typecheck
npm run lint
npm run test
npm run build
npm start
```

Tests use fresh Express instances and injected database checks with Supertest;
they require no database, `.env`, or secrets. They cover liveness independent of
the DB, successful/failed/recovered readiness, JSON 404 responses, and environment
validation. PR CI runs these same checks in a separate backend job; frontend
checks remain in their existing job.

Build output is ignored under `dist/`. `npm start` uses the compiled server,
while `npm run dev` watches TypeScript. Neither command generates Prisma or applies
migrations automatically.

To observe real failure/recovery, stop PostgreSQL with `docker compose stop`,
call both endpoints (health stays 200; readiness becomes 503), then run
`docker compose up -d --wait` and retry readiness.

```sh
docker compose down # Stop/remove containers; preserve the named data volume.
# Destructive local reset only when you intend to discard all development data:
# docker compose down -v
```

Changing PostgreSQL credentials in `.env` does not change credentials in an
already initialized volume. Update them through PostgreSQL or deliberately reset
the local volume; do not discard existing data blindly.
