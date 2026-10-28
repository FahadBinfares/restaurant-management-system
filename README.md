# Restaurant Management System

Internal Arabic (RTL) operations system for a Saudi restaurant handling banquet
(ولائم) and daily orders: customers, catalog and banquet packages, orders, payments,
delivery, kitchen reports, dashboards, and audit history.

| Part | Stack | Location |
| --- | --- | --- |
| Web app | React 19, TypeScript, Vite, Tailwind, React Router, TanStack Query, React Hook Form, Zod | `src/` |
| API | Node.js 24, TypeScript, Express 5, Zod, Prisma 7 | `server/` |
| Database | PostgreSQL 17 | `server/prisma/` |
| Deployment | Docker, Nginx, blue/green, GitHub Actions | `deploy/`, `.github/workflows/` |

Documentation:

- [docs/DECISIONS.md](docs/DECISIONS.md) — provisional business decisions (permissions, pricing/VAT,
  workflows, refunds) awaiting product-owner confirmation. **Read this first.**
- [server/README.md](server/README.md) — API, data model, security model, and backend tests.
- [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) — staging/production setup, deployments, rollback, backups.

## Local development

Prerequisites: Node.js 24 and a local PostgreSQL 17 (the Docker Compose file in
`server/compose.yaml` provides one on `127.0.0.1:5433`).

```sh
# API (terminal 1)
cd server
cp .env.example .env            # first time only
npm ci && npm run generate
docker compose up -d --wait     # or any local PostgreSQL matching .env
npm run db:deploy
npm run db:seed-dev             # synthetic catalog, drivers, demo customer
npm run admin:create -- --name "مدير النظام" --phone 05XXXXXXXX   # prints a one-time password
npm run dev

# Web app (terminal 2, repository root)
npm ci
npm run dev                     # http://localhost:5173, proxies /api to 127.0.0.1:3001
```

Sign in with the administrator phone and the printed temporary password; you will be
asked to choose a new password.

## Checks

```sh
npm run lint && npm run typecheck && npm test && npm run build   # web app
npm run test:e2e                                                 # Playwright, real API + PostgreSQL
```

Backend checks (unit and PostgreSQL integration tests) are described in
`server/README.md`. Pull requests to `main` run all of them in CI, plus an end-to-end
job and container image builds.

The end-to-end suite starts the API and Vite itself. It needs a local PostgreSQL and
uses a disposable `restaurant_e2e` database that it wipes and reseeds; override the
connection with `E2E_DATABASE_URL` (loopback hosts and `*_e2e` names only).
