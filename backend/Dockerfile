# The api service of the root compose.yaml: one backend process (docs/adr/0001) running
# dist/index.js as a non-root user. The virtual Device ships too, for `docker compose exec`.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY scripts ./scripts
# The commit deploy built it from (compose.yaml), shown on Settings, System. Declared last,
# so a commit that changes nothing above (docs only) rebuilds nothing above.
ARG APP_VERSION=
ENV APP_VERSION=$APP_VERSION
USER node
EXPOSE 3001
CMD ["node", "dist/index.js"]
