FROM node:20-slim

WORKDIR /app

# Copy package files and install
COPY package*.json ./
RUN npm install

# Copy all source code
COPY . .

# Build client (Vite)
RUN npx vite build

# Build server (esbuild)
RUN npx esbuild server/index.ts --platform=node --bundle --format=cjs --outfile=dist/index.cjs --define:process.env.NODE_ENV=\"production\" --minify --external:better-sqlite3

# Create data directory for SQLite persistence
RUN mkdir -p /data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000
ENV DATABASE_PATH=/data/jobtrack.db

# Expose port
EXPOSE 5000

# Start the production server
CMD ["node", "dist/index.cjs"]
