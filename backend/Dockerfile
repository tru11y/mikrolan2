# Containerized API. Runs on the VPS with `--network host --cap-add NET_ADMIN`
# so it drives the host `wg-mgmt` interface (wireguard-tools bundled).
# Build LOCALLY (the 2 GB VPS OOMs on builds), then `docker save | ssh docker load`.
# node:22-slim (Debian) → argon2 prebuilt binaries, no native toolchain needed.
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --no-audit --no-fund
COPY . .
RUN npx prisma generate \
  && npm run build \
  && npx tsc prisma/seed.ts --rootDir prisma --outDir dist \
     --module commonjs --target ES2022 --moduleResolution node \
     --esModuleInterop --skipLibCheck --resolveJsonModule

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends wireguard-tools iproute2 \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# prisma CLI kept (in dependencies) so `prisma migrate deploy` runs in-container.
RUN npm install --omit=dev --no-audit --no-fund
COPY prisma ./prisma
# Generate the client + query engine against THIS runtime (debian-openssl-3.0.x).
RUN npx prisma generate
COPY --from=build /app/dist ./dist
EXPOSE 3002
CMD ["node", "dist/main.js"]
