# Galaxy Andromeda — один контейнер: Fastify API + статика Nuxt
FROM node:20-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.13.1 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/rules/package.json packages/rules/
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
COPY harness/mcp-server/package.json harness/mcp-server/
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY packages/rules packages/rules
COPY packages/client packages/client
COPY packages/server packages/server
COPY maps maps
RUN pnpm run build:deploy
RUN pnpm prune --prod

FROM base AS runner
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV CLIENT_STATIC_DIR=/app/packages/client/.output/public
WORKDIR /app
COPY --from=build /app /app
EXPOSE 3001
CMD ["node", "packages/server/dist/index.js"]
