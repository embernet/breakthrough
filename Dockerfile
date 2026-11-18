# Breakthrough: falling-block innovation puzzle. Node 24, no native deps.
FROM node:24-bookworm

LABEL org.opencontainers.image.title="Breakthrough" \
      org.opencontainers.image.description="Problems rise, solutions fall: a falling-block innovation puzzle"

ENV NODE_ENV=production \
    PORT=8195 \
    DATA_DIR=/data

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY src/ src/
COPY public/ public/
COPY modes/ modes/

EXPOSE 8195
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=4s --start-period=8s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8195)+'/healthz').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

CMD ["node", "src/server.js"]
