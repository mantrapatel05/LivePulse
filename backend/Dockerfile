FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# The SDK needs to exist at public/sdk before the API can serve it.
RUN npm run build:sdk

EXPOSE 5000

CMD ["node", "server.js"]
