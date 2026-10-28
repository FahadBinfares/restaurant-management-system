# Deployment runbook

Status: **prepared, not yet exercised on real infrastructure.** The images are built
in CI; the server-side scripts and GitHub deployment jobs have not run against a real
VPS yet. Treat the first staging deployment as the test of this runbook.

## Topology

```
Internet ──443──▶ edge (Nginx, TLS, blue/green switch)
                    │
                    ├─▶ web-blue  (Nginx: SPA + /api proxy) ─▶ api-blue  ─┐
                    └─▶ web-green (Nginx: SPA + /api proxy) ─▶ api-green ─┴─▶ managed PostgreSQL (TLS)
```

One VPS per environment (staging, production), each with its own managed PostgreSQL,
credentials, and domain. Staging never receives copies of production customer data.

Images (built once per commit by `.github/workflows/deploy.yml`, pushed to GHCR):

| Image | Contents |
| --- | --- |
| `…-api:<sha>` | Compiled API, production dependencies only, runs as `node` (non-root), read-only filesystem |
| `…-migrate:<sha>` | Prisma CLI + migrations, run once per deployment |
| `…-web:<sha>` | Built SPA in Nginx with security headers |

Production deploys the **same image tags** that staging ran.

## One-time server setup

1. Ubuntu LTS VPS. Create a `deploy` user with SSH-key login; disable root SSH login and
   password authentication (`PermitRootLogin no`, `PasswordAuthentication no`). Enable
   unattended security updates.
2. Firewall: allow 22 (preferably restricted to known IPs), 80, 443 only.
3. Install Docker Engine and the Compose plugin; add `deploy` to the `docker` group.
4. `sudo mkdir -p /opt/rms && sudo chown deploy /opt/rms`, then copy the `deploy/`
   directory contents there.
5. Create `/opt/rms/deploy.env` and `/opt/rms/app.env` from the examples
   (`chmod 600 app.env`). Use a dedicated least-privilege database role and `sslmode=require`.
6. Let the server pull images: `docker login ghcr.io` with a GitHub token that has only
   `read:packages`.
7. TLS: obtain a certificate with certbot using the webroot `/var/www/certbot`
   (before the first deployment, `certbot certonly --standalone -d <domain>` is simplest)
   and enable automatic renewal with a hook that reloads the edge
   (`docker compose -p rms-edge -f /opt/rms/compose.edge.yaml exec edge nginx -s reload`).
8. First deployment: `/opt/rms/deploy.sh <commit-sha>`, then create the first administrator:
   `docker exec -it rms-blue-api-1 node dist/scripts/create-admin.js --name "…" --phone 05…`.

## GitHub configuration

Create environments **staging** and **production** (Settings → Environments):

- `production`: add required reviewers (the manual approval gate) and restrict to `main`.
- Variables: `STAGING_HOST`, `PRODUCTION_HOST`, `DEPLOY_USER`.
- Environment secrets (separate per environment): `DEPLOY_SSH_KEY` (a dedicated key
  authorised only for `deploy`), `STAGING_KNOWN_HOSTS` / `PRODUCTION_KNOWN_HOSTS`
  (output of `ssh-keyscan`, verified out of band).

Until `STAGING_HOST` is set, the workflow only builds images. Rotate keys and database
passwords by updating the secret / `app.env` and redeploying.

## Deploying and rolling back

- Merge to `main` → images build → staging deploys → production waits for approval.
- Redeploy an existing build: run the workflow manually with the commit SHA.
- `deploy.sh` runs migrations, starts the idle colour, checks `/api/ready` through it,
  switches the edge, and stops the old colour after 30 s (kept for rollback).
- `rollback.sh` switches traffic back to the previous colour. **It does not undo
  migrations.**

### Database migrations (expand/contract)

The old colour keeps serving traffic while migrations run, so every migration must be
compatible with the previous release:

1. *Expand*: add nullable columns/tables, backfill, deploy code that uses them.
2. *Contract*: remove old columns in a **later** release once nothing reads them.

Never rename or drop a column in the same release that stops using it. A migration
that cannot be made compatible needs a maintenance window and an explicit plan.

## Backups and recovery

Use the managed provider's automated backups with point-in-time recovery. Additionally
schedule encrypted off-site logical backups (`pg_dump` → `age`/`gpg` → object storage)
and **test a restore into a scratch database at least monthly**. RPO, RTO, and retention
are open decisions (docs/DECISIONS.md); until decided, assume daily off-site copies kept
30 days.

## Monitoring

- Uptime check on `https://<domain>/api/ready` (alerts by email).
- Containers log to Docker's json-file driver with rotation; `docker compose logs`.
  Logs never contain passwords, tokens, or request bodies.
- Host metrics (CPU, RAM, disk) and container health: a lightweight agent from the VPS
  or managed-database provider is sufficient at this scale.
