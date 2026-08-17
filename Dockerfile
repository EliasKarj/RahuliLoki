# Single container: Fastify serves the API and the built SPA from one port, with the SQLite
# file on a mounted volume. The poller needs a persistent process, so there is no static-host
# version of this app — see CLAUDE.md.

FROM node:22-slim AS build
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

# Manifests first: the dependency layer only rebuilds when a manifest actually changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY server/package.json ./server/
COPY web/package.json ./web/
RUN pnpm install --frozen-lockfile

COPY server ./server
COPY web ./web

# The Prisma client is generated code; it has to exist before the server compiles.
RUN pnpm --filter @whatremains/server exec prisma generate
RUN pnpm --filter @whatremains/web build
RUN pnpm --filter @whatremains/server build

# Ship only what runs: compiled server, built SPA, production dependencies, migrations.
#
# The generated Prisma client is copied like any other build output. It used to need a second
# `prisma generate` here, because the default output — node_modules/.prisma — is not something
# `pnpm deploy` reproduces, and the copied @prisma/client was the ungenerated stub with no
# named ESM exports. schema.prisma now emits into server/generated, which removes the special
# case entirely; the same change is what made the desktop package work.
RUN pnpm --filter @whatremains/server --prod deploy --legacy /runtime \
  && cp -r server/dist /runtime/dist \
  && cp -r server/generated /runtime/generated \
  && cp -r server/prisma /runtime/prisma \
  && cp -r web/dist /runtime/public


FROM node:22-slim AS runtime
WORKDIR /app

# Prisma's query engine needs OpenSSL, which the slim image does not carry.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build --chown=node:node /runtime ./
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

# The database lives on a volume; everything else in the image is disposable. Creating the
# directory as `node` before declaring the volume is what makes a named volume come up owned
# by the unprivileged user rather than by root.
RUN mkdir -p /data && chown node:node /data

ENV NODE_ENV=production
ENV DATABASE_URL=file:/data/what-remains.db
ENV PORT=3000
# A container has to bind every interface to be reachable through a port mapping at all. That
# is a wide bind, so the server refuses to start unless the operator supplies AUTH_TOKEN — or
# sets ALLOW_UNAUTHENTICATED to say something else is doing the authenticating (a port mapping
# published only to 127.0.0.1, a proxy with its own auth). Neither is baked in: the image
# cannot know which is true, and a guess would be wrong in the direction that exposes data.
ENV HOST=0.0.0.0
ENV WEB_DIST=/app/public
VOLUME ["/data"]
EXPOSE 3000

USER node
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "dist/index.js"]

# /api/health answers 200 whenever the process is up — including when the poller is halted,
# which a restart would not fix. This checks that the server is serving, nothing more.
HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
