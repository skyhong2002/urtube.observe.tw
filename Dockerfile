FROM node:22-alpine
WORKDIR /app

# npm is not an init process: it never reaps orphans. Each health check that
# hit its timeout left a defunct wget behind (530 in the app container on
# 2026-10-22). tini reaps them and still forwards SIGTERM to the service.
RUN apk add --no-cache tini
ENTRYPOINT ["/sbin/tini", "--", "docker-entrypoint.sh"]

# Install production deps first (better layer caching).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY tsconfig.json ./
COPY src ./src
COPY public/landing ./public/landing
COPY scripts ./scripts
COPY chrome-extension ./chrome-extension
COPY favicon.svg og.png ./

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD wget -q -T 4 -O- http://127.0.0.1:${PORT:-3000}/healthz || exit 1

CMD ["npx", "tsx", "src/index.ts"]
