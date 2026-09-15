# Imagen del portal: compila el panel (admin/) y lo sirve junto al servidor (server/).
FROM node:22-bookworm-slim AS admin
WORKDIR /build/admin
COPY admin/package*.json ./
RUN npm ci
COPY admin/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app/server
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY server/package*.json ./
RUN npm ci --omit=dev && apt-get purge -y python3 make g++ && apt-get autoremove -y
COPY server/ ./
COPY --from=admin /build/admin/dist /app/admin/dist
ENV ADMIN_DIST=/app/admin/dist DB_FILE=/app/server/data/iptv.db
VOLUME /app/server/data
EXPOSE 8080 25461
CMD ["node", "src/index.js"]
