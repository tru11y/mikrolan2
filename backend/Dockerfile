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
  && apt-get install -y --no-install-recommends wireguard-tools iproute2 libcap2-bin \
  # `wg` needs CAP_NET_ADMIN to touch the host interface. Grant it to the
  # binary itself (file capability) instead of running the whole Node
  # process as root — the container still needs `--cap-add=NET_ADMIN` at
  # `docker run` so this capability is in the container's bounding set.
  && setcap cap_net_admin+ep /usr/bin/wg \
  && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
# prisma CLI kept (in dependencies) so `prisma migrate deploy` runs in-container.
RUN npm install --omit=dev --no-audit --no-fund
COPY prisma ./prisma
# Generate the client + query engine against THIS runtime (debian-openssl-3.0.x).
RUN npx prisma generate
COPY --from=build /app/dist ./dist
RUN chown -R node:node /app
# node:22-slim ships a built-in unprivileged `node` user (uid 1000) — use it
# instead of root; `wg` keeps working via the setcap file capability above.
USER node
EXPOSE 3002
CMD ["node", "dist/main.js"]
