# Krabi Flight Radar — API + built web app in one container.
# Uses the official Playwright image so the booking-flow price check has a working Chromium.
FROM mcr.microsoft.com/playwright:v1.56.0-noble

WORKDIR /app
ENV NODE_ENV=production PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm ci --include=dev --no-audit --no-fund

COPY . .
RUN npm run build

EXPOSE 4000
CMD ["node", "packages/server/dist/main.js"]
