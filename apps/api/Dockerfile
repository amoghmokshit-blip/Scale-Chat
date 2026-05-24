# syntax=docker/dockerfile:1.7

# Multi-stage build: keep the runtime image small + free of build tooling.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
# Copy workspace manifests for cache-friendly install.
COPY package.json package-lock.json* ./
COPY tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
# npm workspaces install — uses only manifests so the layer caches across code changes.
RUN npm ci --workspaces --include-workspace-root --omit=dev || npm install --workspaces --include-workspace-root --omit=dev

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/shared/node_modules ./packages/shared/node_modules
COPY . .
# argon2 native build needs python + make; only in this stage.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ openssl ca-certificates \
 && npm install --workspaces --include-workspace-root \
 && npm --workspace=packages/shared run build \
 && npm --workspace=apps/api run prisma:generate \
 && npm --workspace=apps/api run build \
 && apt-get purge -y python3 make g++ && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates openssl tini && rm -rf /var/lib/apt/lists/*
# Drop privileges.
RUN useradd -m -u 10001 -s /bin/false api
COPY --from=build --chown=api:api /app/node_modules ./node_modules
COPY --from=build --chown=api:api /app/packages ./packages
COPY --from=build --chown=api:api /app/apps/api/dist ./apps/api/dist
COPY --from=build --chown=api:api /app/apps/api/prisma ./apps/api/prisma
COPY --from=build --chown=api:api /app/apps/api/package.json ./apps/api/package.json
USER api
EXPOSE 4000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/api/dist/main.js"]
