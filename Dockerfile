# Node 26 matches the development runtime. It matters: the database layer uses
# the built-in node:sqlite module, which is only stable on recent Node. Dropping
# to an older base would reintroduce a native dependency.
FROM node:26-slim AS build

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:26-slim

WORKDIR /app
ENV NODE_ENV=production \
    DATA_DIR=/app/data \
    PORT=3000 \
    HOST=0.0.0.0

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/build ./build

# The image runs as the unprivileged `node` user (uid 1000), which matches the
# host user in the common single-user case — so the bind-mounted credentials and
# data directory are readable without a chown dance.
RUN mkdir -p /app/data && chown -R node:node /app/data
USER node

EXPOSE 3000
CMD ["node", "build"]
