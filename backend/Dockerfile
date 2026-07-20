# Optional containerized build of the API. Note: on the VPS the API runs
# bare-metal (systemd) so it can drive the host `wg-mgmt` interface directly.
# Build locally (the 2 GB VPS OOMs on `npm run build`), then ship dist/.
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npx prisma generate && npm run build

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY prisma ./prisma
EXPOSE 3002
CMD ["node", "dist/main.js"]
