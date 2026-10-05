# Builds the frontend with no API address (same-origin, docs/adr/0005) and serves it from
# nginx, which also proxies /api/ to the api service. Built by the root compose.yaml.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# The unprivileged build of the same nginx: it runs as the nginx user, not root, and so
# listens on 8080 (nginx.conf); compose.yaml maps the host's WEB_PORT onto it.
FROM nginxinc/nginx-unprivileged:1.28-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 8080
