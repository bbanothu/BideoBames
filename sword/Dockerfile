# Ashen Oath: static game files + WebSocket relay, served by server/server.js.
# node:22-alpine is multi-arch, so this builds natively on a Raspberry Pi (arm64).
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8137

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

USER node
EXPOSE 8137
CMD ["node", "server/server.js"]
