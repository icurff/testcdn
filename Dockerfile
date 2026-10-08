FROM node:22-slim AS base

RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

COPY package*.json ./
RUN npm ci --omit=dev

FROM base AS development
RUN npm install -g nodemon

EXPOSE 3000

CMD ["nodemon", "--legacy-watch", "--ignore", "outputs", "--ignore", "tmp", "--ignore", "uploads", "server.js"]

FROM base AS production

ENV NODE_ENV=production

COPY *.js ./
COPY public ./public
RUN mkdir -p outputs tmp

EXPOSE 3000

CMD ["node", "server.js"]
