FROM node:24-alpine

WORKDIR /app

COPY --chown=node:node package*.json ./
RUN npm install --omit=dev

COPY --chown=node:node . .

USER node

# The SDK needs to exist at public/sdk before the API can serve it.
RUN npm run build:sdk

HEALTHCHECK --interval=30s --timeout=3s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/health/ready').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

EXPOSE 5000

CMD ["node", "server.js"]
