FROM node:20-alpine AS ozen-build

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npx tsc

FROM node:20-alpine AS ozen-run

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev
COPY --from=ozen-build /app/dist ./dist
USER node
EXPOSE 4000

CMD ["node", "dist/index.js"]
