FROM node:22.14.0-bookworm-slim

WORKDIR /app
COPY package.json ./
COPY src ./src
COPY test ./test
COPY healthcheck.mjs ./

USER node
CMD ["node", "src/index.mjs"]
