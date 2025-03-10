FROM node:23-alpine

WORKDIR /usr/src/app

RUN apk add --no-cache ffmpeg
RUN corepack enable pnpm

COPY package.json pnpm-lock.yaml ./

RUN pnpm install

# COPY prisma ./prisma
# RUN npx prisma generate || true

COPY . .
