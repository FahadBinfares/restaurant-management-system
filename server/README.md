# Local backend foundation

Development only, not production-ready. This server exposes health/readiness and
a minimal customer API. It has no authentication or authorization. **Do not expose
it publicly or use real customer personal data until access control is implemented.**
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

The foundation migration creates a technical `DevelopmentProbe` table; the next
migration adds the minimal `Customer` table, without addresses or orders. No rows
are seeded. `npm run db:deploy` applies the checked-in
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

## Customer API (synthetic local/test data only)

The customer record contains a generated UUID, name, canonical phone, nullable
notes, and UTC `createdAt`/`updatedAt` timestamps. Names are trimmed, nonempty, and
at most 120 characters; notes are optional/null or a trimmed string up to 2000
characters. Unknown body fields are rejected; JSON bodies are limited to 16 KiB.

Phone normalization is deliberately narrow: after trimming surrounding whitespace,
accept exactly ASCII `05xxxxxxxx`, `9665xxxxxxxx`, or `+9665xxxxxxxx`. Store only
`+9665xxxxxxxx`. Reject spaces inside the number, hyphens, Arabic-Indic digits,
other country codes, missing prefixes, and wrong lengths rather than guessing.
This validates format, not carrier ownership or whether a number is assigned.
PostgreSQL enforces canonical format and uniqueness, including concurrent writes.

```sh
curl -i http://127.0.0.1:3001/api/customers \
  -H 'Content-Type: application/json' \
  -d '{"name":"عميل اختبار","phone":"0500000000","notes":"Synthetic example only"}'
curl -i 'http://127.0.0.1:3001/api/customers?page=1&pageSize=20'
# Replace UUID with the id returned by POST:
curl -i http://127.0.0.1:3001/api/customers/UUID
```

POST returns 201, a `Location` header, and `{ "data": customer }`. Get-by-ID returns
200 with the same envelope, 400 for an invalid UUID, or 404 if not found. List returns
`{ "data": [...], "pagination": { "page": 1, "pageSize": 20, "total": 0 } }`.
Page defaults to 1 (maximum 1,000,000); pageSize defaults to 20 (maximum 100), both
strict positive decimal integers. Unknown/repeated query parameters are rejected.
Ordering is newest `createdAt` first, then UUID descending to break timestamp ties;
the count and page are read in one repeatable-read transaction. Offset pages can
still shift between separate requests when new customers are inserted.

Customer errors use `{ "error": { "code": "...", "message": "..." } }`:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 400 | INVALID_INPUT | Invalid body, JSON, UUID, or pagination |
| 409 | PHONE_CONFLICT | Phone already registered in any accepted format |
| 413 | PAYLOAD_TOO_LARGE | JSON body exceeds limit |
| 503 | DATABASE_UNAVAILABLE | Customer storage failed; no raw DB error is returned |

Customer responses use `Cache-Control: no-store`. Health/readiness contracts remain
unchanged. No customer UI, search, edits, address book, or access-control policy is
implemented in this issue.

### Real PostgreSQL integration tests

`npm run test` retains the database-independent tests. The separate integration
command requires an explicit loopback `TEST_DATABASE_URL` whose database name ends
in `_test` or `_ci`, and a local test user allowed to create/drop databases:

```sh
# First-time creation of a local administrative test database:
docker compose exec postgres sh -c 'createdb -U "$POSTGRES_USER" restaurant_test'
# Public development-only sample credentials; use your own local settings if changed:
TEST_DATABASE_URL=postgresql://restaurant_dev:local-development-only@127.0.0.1:5433/restaurant_test \
  npm run test:integration
```

Each run creates a unique `restaurant_test_<random>` database, applies all committed
Prisma migrations, exercises the real API/Prisma/PostgreSQL path, and drops only that
database at teardown. It never clears the supplied base database or falls back to
`DATABASE_URL`. All records are synthetic. Coverage includes persistence, phone
normalization/uniqueness under concurrency, get/list, invalid input, pagination ties,
and actual authentication failure. CI requires these tests before its existing live
health/readiness checks, using its ephemeral PostgreSQL service. On forced process
termination a test database may remain; remove only its exact generated name after
confirming no test run uses it.

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
