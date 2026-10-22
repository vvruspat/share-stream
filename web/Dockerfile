FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json tsconfig.server.json ./
COPY src ./src
COPY shared ./shared
COPY server ./server
RUN npm run build

FROM node:24.22.0-alpine AS runtime
ARG SHARE_STREAM_REVISION=local
LABEL org.opencontainers.image.source="https://github.com/vvruspat/share-stream" \
      org.opencontainers.image.revision=$SHARE_STREAM_REVISION
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
RUN mkdir /app/data && chown node:node /app/data
USER node
ENV NODE_ENV=production PORT=48101 SHARE_STREAM_REVISION=$SHARE_STREAM_REVISION
EXPOSE 48101
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:48101/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "dist/server/index.js"]
