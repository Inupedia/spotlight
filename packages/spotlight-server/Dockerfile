FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/spotlight-client/package.json ./packages/spotlight-client/package.json
COPY packages/spotlight-memory/package.json ./packages/spotlight-memory/package.json
COPY packages/spotlight-protocol/package.json ./packages/spotlight-protocol/package.json
COPY packages/spotlight-server/package.json ./packages/spotlight-server/package.json
COPY packages/spotlight-vue/package.json ./packages/spotlight-vue/package.json
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store corepack enable && pnpm config set store-dir /pnpm/store && pnpm install --frozen-lockfile
COPY packages ./packages
RUN pnpm --filter @inupedia/spotlight-protocol build && pnpm --filter @inupedia/spotlight-memory build && pnpm --filter @inupedia/spotlight-server build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates wget \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build /app/packages/spotlight-protocol ./packages/spotlight-protocol
COPY --from=build /app/packages/spotlight-memory ./packages/spotlight-memory
COPY --from=build /app/packages/spotlight-server ./packages/spotlight-server
COPY --from=build /app/node_modules ./node_modules
EXPOSE 8787
ENTRYPOINT ["node", "packages/spotlight-server/dist/cli.js"]
