FROM node:20-alpine

# Outils de compilation nécessaires à better-sqlite3 (module natif).
# Nécessaire même si un binaire précompilé existe pour la plupart des
# architectures, au cas où (ex: Raspberry Pi / ARM avec une variante non couverte).
RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p /app/data

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
