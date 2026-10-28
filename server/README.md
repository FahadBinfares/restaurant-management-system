# API server

Express 5 + TypeScript + Prisma 7 on PostgreSQL. The backend is the single source of
truth for validation, authorization, pricing, workflow transitions, and data
integrity; the web app's checks are conveniences only.

## Setup and scripts

```sh
cp .env.example .env     # local development values; never commit real secrets
npm ci
npm run generate         # Prisma client → src/generated (after every install/schema change)
npm run db:deploy        # apply migrations
npm run dev              # watch mode on 127.0.0.1:3001
```

| Script | Purpose |
| --- | --- |
| `typecheck`, `lint`, `test`, `build`, `start` | Standard checks (unit tests need no database) |
| `test:integration` | API tests against real PostgreSQL (`TEST_DATABASE_URL`, loopback `*_test`/`*_ci` only) |
| `db:migrate -- --name x` | Create a migration in development; review the SQL before committing |
| `db:seed-dev` | Synthetic demo data; refuses unless `APP_ENV=development` |
| `admin:create -- --name … --phone …` | Bootstrap the first administrator (one-time password); refuses once an admin exists |
| `admin:create:prod` | Same, from the compiled build (inside the API container) |
| `e2e:serve` | Reset a disposable `*_e2e` database and start the API (used by Playwright) |

Environment variables are validated at start-up (`src/env.ts`); errors name the
variable without echoing values. `APP_ENV=staging|production` defaults to `Secure`
cookies and mandatory administrator MFA, and production refuses to disable either.
Set `TRUST_PROXY=true` only behind exactly one trusted proxy hop.

## Layout

```
src/
  app.ts                 Express app: security headers, CSRF guard, routers, error handler
  auth/                  passwords (scrypt), TOTP, sessions, permissions, auth routes
  domain/                pure logic: pricing (halalas, VAT), status machines, Riyadh time
  modules/               customers, employees, settings+audit, catalog, orders, payments,
                         delivery, reports (kitchen, dashboard), draft archiving
  http/                  error envelope, shared Zod schemas, rate limiting
  scripts/               admin bootstrap, dev seed, e2e database preparation
integration/             PostgreSQL-backed API tests (one fresh database per file)
prisma/                  schema and SQL migrations (with CHECK constraints and triggers)
```

## Security model

- **Authentication:** phone + password (scrypt N=2^15). Five consecutive failures lock
  the account for 15 minutes; login is also rate limited per IP. Unknown accounts take
  the same time as known ones.
- **Sessions:** random 256-bit token in an `HttpOnly`, `SameSite=Strict` cookie scoped to
  `/api`; only its SHA-256 is stored. Idle timeout (15/30/60 min, setting) and a 12-hour
  absolute lifetime are enforced on every request. Password changes and resets revoke
  other sessions; deactivation revokes all.
- **MFA:** TOTP (RFC 6238). Mandatory for administrators in staging/production: until
  enrolled, an admin session can only reach account-setup endpoints. Temporary
  passwords likewise restrict a session until changed.
- **CSRF:** `SameSite=Strict` plus a required `X-Requested-With: rms` header on every
  state-changing request.
- **Authorization:** every route checks named permissions (`src/auth/permissions.ts`):
  role defaults plus per-employee grants/revocations. Payment fields are stripped from
  order responses without `view_payments`.
- **Errors:** `{ "error": { "code", "message", "details?" } }`. Validation details list
  field paths, never submitted values; database errors are never echoed; Prisma error
  messages are not logged because they can contain personal data.

## Data integrity

- Money is **integer halalas**, VAT-inclusive at 15 % (rate snapshotted per order).
  `src/domain/pricing.ts` computes totals; CHECK constraints keep
  `total = subtotal − discount + deliveryFee` and line totals consistent.
- Order lines snapshot names and prices; package contents are copied per order, so
  catalog edits never alter existing orders. Customer name/phone and delivery address
  are snapshotted too.
- `ORD-YYYY-NNNN` numbers come from a per-year counter row updated in the creating
  transaction (Riyadh calendar year).
- Edits require the order `version`; stale writes get `409 VERSION_CONFLICT`. Order
  mutations, payments, and delivery changes lock the order row (`SELECT … FOR UPDATE`).
- Creation and payments accept idempotency keys, so double submits do nothing extra.
- `AuditLog` is append-only and `Payment` only allows voiding (database triggers).

## Main endpoints

All under `/api`; everything except `health`, `ready`, and `auth/login` needs a session.

| Area | Endpoints |
| --- | --- |
| Health | `GET health` (liveness), `GET ready` (database reachable) |
| Auth | `POST auth/login`, `POST auth/logout`, `GET auth/me`, `POST auth/password`, `GET/DELETE auth/sessions`, `POST auth/mfa/{setup,enable,disable}` |
| Employees | `GET/POST employees`, `PATCH employees/:id`, `PUT employees/:id/permissions`, `POST employees/:id/{reset-password,reset-mfa,revoke-sessions}` |
| Settings / audit | `GET/PATCH settings`, `GET audit` |
| Customers | `GET/POST customers` (`q` searches name/phone), `GET/PATCH customers/:id`, `POST customers/:id/{archive,restore}`, addresses, `GET customers/:id/balance` |
| Catalog | `GET/POST/PATCH catalog/{categories,products,packages}` |
| Orders | `GET orders` (filters: `q`, `date`, `from`, `to`, `status`, `paymentStatus`, `deliveryStatus`, `fulfillmentType`, `orderType`, `customerId`, `driverId`, `archived`), `POST orders` (`Idempotency-Key`), `GET/PATCH orders/:id`, `POST orders/:id/{confirm,status,cancel,archive,restore}`, `GET orders/:id/audit` |
| Payments | `GET/POST orders/:id/payments`, `POST payments/:id/void`, `GET payments?date=` |
| Delivery | `GET/POST/PATCH drivers`, `GET drivers/:id/schedule`, `POST orders/:id/delivery/{assign,status}` |
| Reports | `GET reports/kitchen?date=`, `POST reports/kitchen/print`, `GET dashboard` |

## Tests

`npm test` covers pure logic and HTTP contracts without a database. The integration
suite (`npm run test:integration`) creates a fresh, fully migrated database per test
file and exercises the real API with Supertest and an injectable clock: login and
lockout, idle/absolute session expiry, MFA, permissions, phone normalization and
uniqueness, order numbering and yearly reset, price snapshots, package customization,
overrides and discounts, confirmation rules, concurrent edits, status transitions,
duplicate submissions, payments under concurrency, voids and refunds, delivery
conflicts, kitchen inclusion rules, dashboard visibility, and database-level
immutability. It refuses to run against anything but loopback databases whose names
end in `_test` or `_ci`.
