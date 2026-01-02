FROM node:20-slim AS build

WORKDIR /app

COPY package.json ./
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install

COPY tsconfig.json ./
COPY src ./src
COPY views ./views
COPY public ./public

RUN npm run build
RUN npm prune --omit=dev

FROM node:20-slim AS runtime

ENV NODE_ENV=production
ENV PORT=8080
ENV DB_PATH=/data/app.db

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/views ./views
COPY --from=build /app/public ./public

EXPOSE 8080

CMD ["node", "dist/index.js"]
