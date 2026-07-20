# Build context: repo root (zarr-layer/)
# Run: docker build -t eodc-zarr-viewer .
#      docker run -p 3000:3000 eodc-zarr-viewer

# ── Stage 1: compile and pack the zarr-layer library ─────────────────────────
FROM node:20-alpine AS lib-builder
WORKDIR /app

COPY package.json package-lock.json tsconfig.json tsup.config.ts ./
COPY src/ ./src/

RUN npm ci --ignore-scripts
RUN npm run build
# Pack produces carbonplan-zarr-layer-<version>.tgz — a real tarball, no symlinks
RUN npm pack


# ── Stage 2: install demo deps and build Next.js ─────────────────────────────
FROM node:20-alpine AS demo-builder
WORKDIR /app/demo

# Bring in the packed tarball and rewrite the file:../ dep to point at it
COPY --from=lib-builder /app/carbonplan-zarr-layer-*.tgz /tmp/zarr-layer.tgz
COPY demo/package.json ./
RUN node -e "\
  const fs=require('fs');\
  const p=JSON.parse(fs.readFileSync('package.json','utf8'));\
  p.dependencies['@carbonplan/zarr-layer']='file:/tmp/zarr-layer.tgz';\
  fs.writeFileSync('package.json',JSON.stringify(p,null,2));\
"

# npm install (not ci) because we modified package.json
RUN npm install --force --ignore-scripts

COPY demo/ ./
RUN npm run build


# ── Stage 3: production runner ────────────────────────────────────────────────
FROM node:20-alpine AS runner
WORKDIR /app/demo

ENV NODE_ENV=production
ENV PORT=3000

COPY --from=demo-builder /app/demo/.next ./.next
COPY --from=demo-builder /app/demo/public ./public
COPY --from=demo-builder /app/demo/node_modules ./node_modules
COPY --from=demo-builder /app/demo/package.json ./package.json

EXPOSE 3000
CMD ["node_modules/.bin/next", "start"]
