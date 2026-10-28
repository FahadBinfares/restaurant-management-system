# syntax=docker/dockerfile:1
# API image. Secrets are never baked in: DATABASE_URL and friends arrive at runtime.

FROM node:24-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build && npm prune --omit=dev

# One-off migration runner: `docker compose run --rm migrate`.
# Kept separate so the runtime image ships without the Prisma CLI.
FROM deps AS migrate
COPY prisma ./prisma
COPY prisma.config.ts ./
USER node
CMD ["npx", "prisma", "migrate", "deploy"]

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /app/package.json ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
USER node
EXPOSE 3001
HEALTHCHECK --interval=10s --timeout=3s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || 3001) + '/api/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "dist/index.js"]
