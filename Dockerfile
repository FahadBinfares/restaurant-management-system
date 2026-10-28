# syntax=docker/dockerfile:1
# Web image: the built React app served by Nginx, which also proxies /api to the API
# container of the same deployment colour (see deploy/).

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM nginx:1.28-alpine AS runtime
COPY deploy/nginx/web.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
# The official image renders templates with envsubst at start-up (API_UPSTREAM).
ENV API_UPSTREAM=api:3001
EXPOSE 8080
HEALTHCHECK --interval=10s --timeout=3s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
