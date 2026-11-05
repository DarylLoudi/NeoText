# syntax=docker/dockerfile:1
# NeoText production image. Build with `docker build -t neotext .`

FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages/shared packages/shared
COPY apps/server apps/server
COPY apps/web apps/web
# --ignore-scripts: better-sqlite3 ships prebuilt binaries, but npm would otherwise try to compile
# it from source, which needs a compiler that node:24-slim does not have.
RUN npm ci --ignore-scripts
RUN npm run build -w @neotext/web

FROM node:24-slim AS run
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/server apps/server
COPY packages/shared packages/shared
COPY apps/web/package.json apps/web/package.json
# The server runs from TypeScript source through tsx, so production dependencies include it.
RUN npm ci --omit=dev --ignore-scripts
COPY --from=build /app/apps/web/dist apps/web/dist

ENV NODE_ENV=production \
    NEOTEXT_HOST=0.0.0.0 \
    NEOTEXT_DATA_DIR=/data \
    NEOTEXT_WEB_DIST=/app/apps/web/dist

RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3420

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3420/api/health').then(r=>process.exitCode=r.ok?0:1)"

CMD ["node","--import","tsx","apps/server/src/index.ts"]
