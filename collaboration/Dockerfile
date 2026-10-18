FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY server.mjs ./
COPY public ./public
USER node
ENV NODE_ENV=production PORT=48101
EXPOSE 48101
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:48101/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
